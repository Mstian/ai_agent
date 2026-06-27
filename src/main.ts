import readline from 'node:readline';
import { ConfigManager } from './config/loader.js';
import { ProviderFactory } from './provider/factory.js';
import { ChatManager } from './chat/manager.js';
import { Agent } from './agent/agent.js';
import { ToolExecutor } from './agent/tool_executor.js';
import { ToolRegistry } from './tools/registry.js';
import { ReadFileTool } from './tools/read_file.js';
import { WriteFileTool } from './tools/write_file.js';
import { EditFileTool } from './tools/edit_file.js';
import { RunCommandTool } from './tools/run_command.js';
import { GlobTool } from './tools/glob.js';
import { GrepTool } from './tools/grep.js';
import { PromptManager } from './prompt/manager.js';
import { CacheMonitor } from './prompt/cache_monitor.js';
import { PermissionManager } from './permission/manager.js';
import type { ConfirmAnswer } from './permission/types.js';
import { MCPManager } from './mcp/manager.js';
import { ContextManager } from './context/context_manager.js';
import { MemoryManager } from './memory/memory_manager.js';
import { CommandRegistry } from './commands/registry.js';
import { CommandDispatcher } from './commands/parser.js';
import { CommandCompleter } from './commands/completer.js';
import { registerAllBuiltins } from './commands/builtins.js';
import type { UIContext } from './commands/types.js';
import { SkillLoader } from './skills/skill_loader.js';
import { SkillManager } from './skills/skill_manager.js';
import { SkillLoadTool } from './skills/skill_load_tool.js';
import {
  createSkillCommand,
  registerSkillCommand,
  refreshSkillCommands,
} from './skills/skill_command.js';
import { HookManager } from './hooks/hook_manager.js';
import { RoleLoader } from './subagent/role_loader.js';
import { SubAgentRunner } from './subagent/runner.js';
import { TaskManager } from './subagent/task_manager.js';
import { AgentTool } from './subagent/agent_tool.js';
import { WorktreeManager } from './worktree/worktree_manager.js';

// ANSI 转义码
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const ITALIC = '\x1b[3m';
const MAGENTA = '\x1b[35m';

function streamChar(char: string) {
  process.stdout.write(char);
}

/** 权限确认回调：用 rl.question() 弹出确认提示 */
function createConfirmCallback(rl: readline.Interface): (toolName: string, paramsSummary: string) => Promise<ConfirmAnswer> {
  return (toolName: string, paramsSummary: string): Promise<ConfirmAnswer> => {
    const prompt = `\n${YELLOW}[权限确认]${RESET} 即将执行 ${CYAN}${toolName}${RESET}(${paramsSummary})\n允许？[y=本次/N=拒绝/s=本次会话记住/a=永久记住]\n`;
    return new Promise((resolve) => {
      const ask = () => {
        rl.question(prompt, (answer) => {
          const trimmed = answer.trim().toLowerCase();
          if (trimmed === 'y') resolve('allow');
          else if (trimmed === 's') resolve('allow_session');
          else if (trimmed === 'a') resolve('allow_always');
          else if (trimmed === 'n' || trimmed === '') resolve('deny');
          else {
            process.stdout.write(`${GRAY}请输入 y/N/s/a${RESET}\n`);
            ask();
          }
        });
      };
      ask();
    });
  };
}

async function main() {
  const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeMajor < 18) {
    console.error(`MewCode 需要 Node.js 18+，当前版本: ${process.version}`);
    process.exit(1);
  }

  // 1. 加载配置
  let config;
  try {
    config = ConfigManager.load();
  } catch (err) {
    console.error('配置加载失败:');
    console.error((err as Error).message);
    process.exit(1);
  }

  // 2. 创建组件
  const promptManager = new PromptManager();
  const provider = ProviderFactory.create(config);

  // 2.1. 记忆系统 — 加载项目指令 + 长期记忆
  const memoryManager = new MemoryManager(process.cwd(), provider);
  const memInit = await memoryManager.initialize();

  // 2.15. Skill 系统 — 加载内置+用户+项目 Skill
  const skillLoader = new SkillLoader(process.cwd());
  const skillManager = new SkillManager(skillLoader);
  const availableSkills = skillManager.listAvailable();
  const skillListText = skillManager.buildAvailableList();

  // 子 Agent 角色列表（注入 system prompt，让 Agent 知道有哪些可用）
  const roleLoader = new RoleLoader(process.cwd());
  const roles = roleLoader.listAll();
  let subAgentList = '';
  if (roles.length > 0) {
    subAgentList = '可用的子 Agent 角色:\n';
    for (const r of roles) {
      subAgentList += `- ${r.name}: ${r.description}\n`;
    }
    subAgentList += '\n通过 agent 工具委派任务给子 Agent。';
  }

  // 生成 system prompt（含 Skill 列表 + 子Agent列表 + 项目指令 + 长期记忆）
  let systemPrompt = promptManager.getSystemPrompt({
    cwd: process.cwd(),
    custom_instructions: memInit.customInstructions + (subAgentList ? '\n\n' + subAgentList : ''),
    long_term_memory: memInit.longTermMemory,
    active_skills: skillListText,
  });

  const chatManager = new ChatManager(provider, systemPrompt);

  // 2.3. 注入会话存档器
  chatManager.setSessionArchiver(memoryManager.getSessionArchiver());

  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new RunCommandTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());

  // 2.4. 初始化 MCP Server（并行，不阻塞启动）
  const mcpManager = new MCPManager(config.mcp_servers ?? {});
  await mcpManager.initialize(registry);

  // 2.45. 注册 skill_load 系统工具
  const skillLoadTool = new SkillLoadTool(skillManager);
  registry.register(skillLoadTool);

  // 设置工具白名单校验器（收集所有有效工具名）
  const allToolNames = registry.getAll().map((t) => t.name);
  skillManager.setValidToolNames(allToolNames);

  const toolExecutor = new ToolExecutor(registry);
  const agent = new Agent(chatManager, toolExecutor, registry, promptManager, {
    maxIterations: 30,
    mode: 'full',
  });

  // 2.5. 注入记忆系统和 Skill 系统到 Agent
  agent.setMemoryManager(memoryManager);
  agent.setSkillManager(skillManager);

  // 2.55. Hook 系统
  const hookManager = new HookManager();
  hookManager.load(process.cwd());
  agent.setHookManager(hookManager);

  // 2.6. 子 Agent 系统
  const subAgentRunner = new SubAgentRunner(provider);
  const taskManager = new TaskManager();

  const agentTool = new AgentTool(
    roleLoader,
    subAgentRunner,
    taskManager,
    () => chatManager.getMessages(),
    () => registry,
  );

  // Worktree 隔离
  const worktreeManager = new WorktreeManager(process.cwd());
  agentTool.setWorktreeManager(worktreeManager);
  // 启动时异步清理过期 worktree
  worktreeManager.cleanExpired(7).catch(() => {});

  registry.register(agentTool);

  // 2.7. 权限系统（readline 创建后再注入确认回调）
  const permissionManager = new PermissionManager(process.cwd());

  // 3. readline（含 Tab 补全）
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: (line: string) => {
      const { completed, matches } = completer.applyCompletion(line);
      if (matches.length > 1) {
        // 多匹配：弹菜单
        process.stdout.write(
          `\n${GRAY}${matches.map((m) => `/${m}`).join('  ')}${RESET}\n`,
        );
        return [[], line]; // 不补全，保持原输入
      }
      return [[completed], line];
    },
  });

  // 确认回调依赖 rl，必须在 rl 创建后设置
  agent.setPermissionManager(permissionManager, createConfirmCallback(rl));

  // 2.8. 上下文管理
  const contextManager = new ContextManager(process.cwd());
  agent.setContextManager(contextManager);

  let abortController: AbortController | null = null;

  // 3.5. 命令系统
  const cmdRegistry = new CommandRegistry();
  registerAllBuiltins(cmdRegistry, () => cmdRegistry);

  // 注册 /skill 命令组
  const skillCmd = createSkillCommand(skillManager, cmdRegistry);
  cmdRegistry.register(skillCmd);

  // 为所有可用 Skill 注册斜杠命令（/commit /review /test 等）
  for (const skill of availableSkills) {
    registerSkillCommand(cmdRegistry, skillManager, skill.name);
  }

  const dispatcher = new CommandDispatcher(cmdRegistry);
  const completer = new CommandCompleter(cmdRegistry);

  // UIContext 实现 — 桥接到实际组件
  const ui: UIContext = {
    showMessage(text: string) {
      process.stdout.write(`\n${GRAY}${text}${RESET}\n`);
    },
    showError(text: string) {
      process.stdout.write(`\n${RED}${text}${RESET}\n`);
    },
    sendToAgent(text: string) {
      // 直接注入 system 消息，下轮 processInput 处理
      chatManager.injectSystemMessage(text);
      process.stdout.write(
        `${GRAY}已将提示词注入对话，下一轮对话生效${RESET}\n`,
      );
    },
    setAgentMode(mode: 'full' | 'plan') {
      agent.setMode(mode);
    },
    getAgentMode() {
      return agent.getMode();
    },
    getTokenUsage() {
      let totalChars = 0;
      for (const m of chatManager.getMessages()) {
        totalChars += typeof m.content === 'string'
          ? m.content.length
          : (m.content as any[]).reduce(
              (s: number, b: any) => s + (b.text ?? b.thinking ?? '').length,
              0,
            );
      }
      return { estimated: Math.ceil(totalChars * 0.5) };
    },
    getCurrentSessionId() {
      return memoryManager.getSessionArchiver().getCurrentSessionId();
    },
    getMemoryManager() {
      return memoryManager;
    },
    clearScreen() {
      process.stdout.write('\x1b[2J\x1b[H');
    },
    requestExit() {
      rl.close();
      process.exit(0);
    },
    getAgent() {
      return agent;
    },
    getPermissionMode() {
      return permissionManager.getMode();
    },
    setPermissionMode(mode: string) {
      if (mode === 'strict' || mode === 'default' || mode === 'permissive') {
        permissionManager.setMode(mode as 'strict' | 'default' | 'permissive');
      }
    },
    abortCurrentTask() {
      if (abortController) {
        abortController.abort();
        abortController = null;
        process.stdout.write(`\n${GRAY}已停止当前任务${RESET}\n`);
      }
    },
    restoreSessionMessages(messages) {
      const chatMsgs = (chatManager as any).messages as import('./provider/types.js').Message[];
      chatMsgs.length = 0;
      chatMsgs.push({ role: 'system', content: systemPrompt });
      for (const msg of messages) {
        chatMsgs.push(msg);
      }
    },
    getSystemPrompt() {
      return systemPrompt;
    },
    async executeAgentPrompt(prompt: string) {
      process.stdout.write(`\n${BOLD}${GREEN}MewCode${RESET}\n`);

      abortController = new AbortController();
      let firstChar = true;

      try {
        const stream = agent.run(prompt, abortController.signal);

        for await (const event of stream) {
          switch (event.type) {
            case 'turn_start':
              process.stdout.write(
                `\n${GRAY}${ITALIC}[第 ${event.turn} 轮]${RESET}\n`,
              );
              firstChar = true;
              break;

            case 'text_delta':
              streamChar(event.text);
              firstChar = false;
              break;

            case 'thinking_delta':
              if (firstChar) {
                process.stdout.write(`${GRAY}${ITALIC}`);
              }
              streamChar(event.text);
              firstChar = false;
              break;

            case 'tool_use': {
              const params = Object.entries(event.tool_input).slice(0, 2);
              const summary = params
                .map(([k, v]) => {
                  const str = typeof v === 'string' ? v : JSON.stringify(v);
                  return str.length > 40
                    ? `${k}: ${str.slice(0, 40)}...`
                    : `${k}: ${str}`;
                })
                .join(', ');
              process.stdout.write(
                `\n${GRAY}⚡ 准备调用: ${event.tool_name}${summary ? ` (${summary})` : ''}${RESET}\n`,
              );
              break;
            }

            case 'tool_executing': {
              const params = Object.entries(event.tool_input).slice(0, 1);
              const summary = params
                .map(([k, v]) => {
                  const str = typeof v === 'string' ? v : JSON.stringify(v);
                  return str.length > 50
                    ? `${k}: ${str.slice(0, 50)}...`
                    : `${k}: ${str}`;
                })
                .join('');
              process.stdout.write(
                `${GRAY}🔧 ${event.tool_name}${summary ? ` ${summary}` : ''}${RESET}`,
              );
              break;
            }

            case 'tool_result': {
              if (event.success) {
                const outputLen = event.output.length;
                const preview = event.output.slice(0, 100).replace(/\n/g, ' ');
                const suffix =
                  outputLen > 100 ? ` ... (${outputLen} 字符)` : '';
                process.stdout.write(
                  `\n${GRAY}✅ ${event.tool_name} 完成: ${preview}${suffix}${RESET}\n`,
                );
              } else {
                process.stdout.write(
                  `\n${RED}❌ ${event.tool_name} 失败: ${event.output.slice(0, 200)}${RESET}\n`,
                );
              }
              break;
            }

            case 'turn_end':
              process.stdout.write(
                `${GRAY}${ITALIC}[第 ${event.turn} 轮结束]${RESET}`,
              );
              break;

            case 'agent_done': {
              const reasonText: Record<string, string> = {
                task_completed: '任务完成',
                max_iterations: `达到迭代上限（${event.totalTurns} 轮）`,
                user_cancelled: '用户取消',
                consecutive_unknown_tools: '连续调用未知工具，已停止',
                stream_error: '流出错，已停止',
              };
              const msg = reasonText[event.stopReason] ?? event.stopReason;
              let cacheMsg = '';
              if (event.cacheInfo) {
                const formatted = CacheMonitor.format(event.cacheInfo);
                if (formatted) cacheMsg = ` · ${formatted}`;
              }
              process.stdout.write(
                `\n${GRAY}${ITALIC}[${msg}${cacheMsg}]${RESET}\n`,
              );
              break;
            }

            case 'error':
              process.stdout.write(
                `\n${RED}❌ ${event.message}${RESET}\n`,
              );
              break;

            case 'done':
              break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          process.stdout.write(
            `\n${RED}❌ ${(err as Error).message}${RESET}\n`,
          );
        }
      }

      process.stdout.write(RESET);
      process.stdout.write('\n');
      abortController = null;
    },
  };

  // 4. 处理用户输入（分流器）
  const processInput = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // 分流：斜杠命令走本地分发
    const handled = await dispatcher.dispatch(trimmed, ui);
    if (handled) return;

    // 非命令：送 Agent
    process.stdout.write(`\n${BOLD}${GREEN}MewCode${RESET}\n`);

    abortController = new AbortController();
    let firstChar = true;

    try {
      const stream = agent.run(trimmed, abortController.signal);

      for await (const event of stream) {
        switch (event.type) {
          case 'turn_start':
            process.stdout.write(
              `\n${GRAY}${ITALIC}[第 ${event.turn} 轮]${RESET}\n`,
            );
            firstChar = true;
            break;

          case 'text_delta':
            streamChar(event.text);
            firstChar = false;
            break;

          case 'thinking_delta':
            if (firstChar) {
              process.stdout.write(`${GRAY}${ITALIC}`);
            }
            streamChar(event.text);
            firstChar = false;
            break;

          case 'tool_use': {
            const params = Object.entries(event.tool_input).slice(0, 2);
            const summary = params
              .map(([k, v]) => {
                const str = typeof v === 'string' ? v : JSON.stringify(v);
                return str.length > 40
                  ? `${k}: ${str.slice(0, 40)}...`
                  : `${k}: ${str}`;
              })
              .join(', ');
            process.stdout.write(
              `\n${GRAY}⚡ 准备调用: ${event.tool_name}${summary ? ` (${summary})` : ''}${RESET}\n`,
            );
            break;
          }

          case 'tool_executing': {
            const params = Object.entries(event.tool_input).slice(0, 1);
            const summary = params
              .map(([k, v]) => {
                const str = typeof v === 'string' ? v : JSON.stringify(v);
                return str.length > 50
                  ? `${k}: ${str.slice(0, 50)}...`
                  : `${k}: ${str}`;
              })
              .join('');
            process.stdout.write(
              `${GRAY}🔧 ${event.tool_name}${summary ? ` ${summary}` : ''}${RESET}`,
            );
            break;
          }

          case 'tool_result': {
            if (event.success) {
              const outputLen = event.output.length;
              const preview = event.output.slice(0, 100).replace(/\n/g, ' ');
              const suffix =
                outputLen > 100 ? ` ... (${outputLen} 字符)` : '';
              process.stdout.write(
                `\n${GRAY}✅ ${event.tool_name} 完成: ${preview}${suffix}${RESET}\n`,
              );
            } else {
              process.stdout.write(
                `\n${RED}❌ ${event.tool_name} 失败: ${event.output.slice(0, 200)}${RESET}\n`,
              );
            }
            break;
          }

          case 'turn_end':
            process.stdout.write(
              `${GRAY}${ITALIC}[第 ${event.turn} 轮结束]${RESET}`,
            );
            break;

          case 'agent_done': {
            const reasonText: Record<string, string> = {
              task_completed: '任务完成',
              max_iterations: `达到迭代上限（${event.totalTurns} 轮），以下是已完成的工作`,
              user_cancelled: '用户取消',
              consecutive_unknown_tools: '连续调用未知工具，已停止',
              stream_error: '流出错，已停止',
            };
            const msg = reasonText[event.stopReason] ?? event.stopReason;
            let cacheMsg = '';
            if (event.cacheInfo) {
              const formatted = CacheMonitor.format(event.cacheInfo);
              if (formatted) cacheMsg = ` · ${formatted}`;
            }
            process.stdout.write(
              `\n${GRAY}${ITALIC}[${msg}${cacheMsg}]${RESET}\n`,
            );
            break;
          }

          case 'error':
            process.stdout.write(
              `\n${RED}❌ ${event.message}${RESET}\n`,
            );
            break;

          case 'done':
            break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        process.stdout.write(
          `\n${RED}❌ ${(err as Error).message}${RESET}\n`,
        );
      }
    }

    process.stdout.write(RESET);
    process.stdout.write('\n');
    abortController = null;
  };

  // 5. 提示符（根据模式显示）
  const showPrompt = () => {
    const parts: string[] = [];
    if (agent.getMode() === 'plan') {
      parts.push(`${MAGENTA}[plan]${RESET}`);
    }
    const permMode = permissionManager.getMode();
    if (permMode !== 'default') {
      parts.push(`${MAGENTA}[${permMode}]${RESET}`);
    }
    const prefix = parts.length > 0 ? parts.join(' ') + ' ' : '';
    rl.setPrompt(`${prefix}${YELLOW}> ${RESET}`);
    rl.prompt();
  };

  // 5.5. 后台任务结果注入
  function injectBackgroundResults(): boolean {
    const completed = taskManager.checkCompleted();
    if (completed.length === 0) return false;

    for (const task of completed) {
      if (task.status === 'done' && task.result) {
        const r = task.result;
        const summary = [
          `[子Agent ${r.roleName ?? 'task'} 完成] (${r.turns} 轮, ~${(r.tokenUsage.input + r.tokenUsage.output).toLocaleString()} tokens, ${r.durationMs}ms)`,
          '',
          r.finalText || '(无输出)',
        ].join('\n');
        chatManager.injectSystemMessage(summary);
        process.stdout.write(
          `\n${GRAY}📬 子 Agent "${r.roleName}" 完成: ${r.finalText.slice(0, 80)}...${RESET}\n`,
        );
      } else if (task.status === 'error') {
        chatManager.injectSystemMessage(
          `[子Agent ${task.roleName ?? 'task'} 失败] ${task.error}`,
        );
        process.stdout.write(
          `\n${RED}❌ 子 Agent "${task.roleName}" 失败: ${task.error}${RESET}\n`,
        );
      }
    }
    return true;
  }

  // 6. 输入循环
  rl.on('line', async (input: string) => {
    rl.pause();
    // 先注入已完成的后台任务结果
    injectBackgroundResults();
    await processInput(input);
    // 再次检查（Agent 执行期间子 Agent 可能完成了）
    injectBackgroundResults();
    showPrompt();
  });

  // 7. Ctrl+C
  let ctrlcCount = 0;
  rl.on('SIGINT', () => {
    ctrlcCount++;
    if (ctrlcCount === 1) {
      if (abortController) {
        abortController.abort();
        abortController = null;
        process.stdout.write(`\n${GRAY}已中断当前任务${RESET}\n`);
      } else {
        process.stdout.write(`\n${GRAY}(再按一次 Ctrl+C 退出)${RESET}\n`);
      }
      showPrompt();
    } else {
      rl.close();
      process.stdout.write('\n再见！\n');
      process.exit(0);
    }
  });

  // 8. 启动
  process.stdout.write(`\n${BOLD}MewCode${RESET} — 终端 AI 编程助手\n`);

  // 显示记忆加载状态
  if (memInit.customInstructions) {
    process.stdout.write(
      `${GRAY}📋 已加载项目指令文件${RESET}\n`,
    );
  }
  if (memInit.longTermMemory) {
    process.stdout.write(
      `${GRAY}🧠 已加载长期记忆索引${RESET}\n`,
    );
  }
  if (hookManager.getRuleCount() > 0) {
    process.stdout.write(
      `${GRAY}🪝 已加载 ${hookManager.getRuleCount()} 条 Hook 规则${RESET}\n`,
    );
  }

  // 显示可恢复会话
  if (memInit.recoverableSessions.length > 0) {
    process.stdout.write(`\n${GRAY}可恢复的会话:${RESET}\n`);
    for (const s of memInit.recoverableSessions.slice(0, 5)) {
      const date = new Date(s.startedAt).toLocaleString('zh-CN');
      process.stdout.write(
        `  ${CYAN}${s.id}${RESET} ${GRAY}${date} · ${s.messageCount} 条消息 · ${s.cwd}${RESET}\n`,
      );
    }
    process.stdout.write(
      `${GRAY}输入 ${CYAN}/resume <id>${RESET}${GRAY} 恢复会话${RESET}\n`,
    );
  }

  process.stdout.write(
    `${GRAY}输入问题开始对话，/help 查看命令，/plan /do 切换模式${RESET}\n`,
  );

  // 开始新会话（如未恢复）
  memoryManager.startSession(process.cwd());

  showPrompt();

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
