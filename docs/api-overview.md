# 简版电商系统 RESTful API 设计

> **设计目标**: 核心电商功能 — 用户、商品、购物车、订单
> **版本**: v1
> **协议**: JSON over HTTPS
> **日期格式**: ISO 8601 (UTC)
> **金额单位**: 分（整数）
> **主键**: UUID v4

---

## 1. 整体架构

### 资源关系

```
User   (1) ──────────> (N) Order       用户拥有多个订单
User   (1) ──────────> (1) Cart        每个用户一个购物车
Cart   (1) ───────────> (N) CartItem   购物车包含多个商品项
Order  (1) ──────────> (N) OrderItem  订单包含多个商品项
Product (1) ────────> (N) CartItem    商品可以被加入多个购物车
Product (1) ────────> (N) OrderItem   商品出现在多个订单中
```

### 路由总览

| 资源 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 用户 | POST | `/api/v1/users` | 注册 |
| 认证 | POST | `/api/v1/auth/login` | 登录 |
| 用户 | GET | `/api/v1/users/:id` | 查看用户信息 |
| 用户 | PUT | `/api/v1/users/:id` | 更新用户信息 |
| 商品 | GET | `/api/v1/products` | 商品列表（分页+过滤） |
| 商品 | GET | `/api/v1/products/:id` | 商品详情 |
| 商品 | POST | `/api/v1/products` | 创建商品（管理员） |
| 商品 | PUT | `/api/v1/products/:id` | 更新商品（管理员） |
| 商品 | DELETE | `/api/v1/products/:id` | 删除商品（管理员） |
| 购物车 | GET | `/api/v1/cart` | 查看购物车 |
| 购物车 | POST | `/api/v1/cart/items` | 添加商品到购物车 |
| 购物车 | PUT | `/api/v1/cart/items/:productId` | 修改数量 |
| 购物车 | DELETE | `/api/v1/cart/items/:productId` | 移除商品 |
| 购物车 | DELETE | `/api/v1/cart` | 清空购物车 |
| 订单 | POST | `/api/v1/orders` | 创建订单（从购物车） |
| 订单 | GET | `/api/v1/orders` | 订单列表 |
| 订单 | GET | `/api/v1/orders/:id` | 订单详情 |
| 订单 | PUT | `/api/v1/orders/:id/status` | 更新订单状态 |

### 通用规范

| 规则 | 约定 |
|------|------|
| **版本管理** | URL 路径版本 `/api/v1/` |
| **分页** | `?page=1&page_size=20`（默认 page=1, page_size=20，最大 100） |
| **排序** | `?sort=-created_at`（负号降序，默认 `-created_at`） |
| **过滤** | `?status=active&category=electronics` |
| **搜索** | `?search=耳机`（模糊匹配 name 和 description） |

### 认证方式

```
Authorization: Bearer <JWT_TOKEN>
```

JWT payload: `{ "user_id": "...", "role": "user|admin", "iat": ..., "exp": ... }`

### 统一错误响应格式

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "人类可读的错误描述",
    "details": {}  // 可选，附加信息
  }
}
```

常见错误码:

| HTTP Status | Code | 说明 |
|-------------|------|------|
| 400 | `VALIDATION_ERROR` | 请求参数校验失败 |
| 401 | `UNAUTHORIZED` | 未登录或 Token 失效 |
| 403 | `FORBIDDEN` | 无权限执行操作 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 资源冲突（重复/库存不足） |
| 429 | `RATE_LIMITED` | 请求频率超限 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

---

## 2. 端点定义

### 2.1 用户 (Users) & 认证 (Auth)

---

#### `POST /api/v1/users` — 注册用户

- **认证**: 无需认证
- **描述**: 创建新用户，自动返回 JWT Token

**Request Body**:

| 字段 | 类型 | 必填 | 校验规则 |
|------|------|------|----------|
| `username` | string | 是 | 3~32 字符，字母数字下划线 |
| `email` | string | 是 | 合法邮箱格式 |
| `password` | string | 是 | 8~128 字符 |

**Response `201 Created`**:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "alice",
  "email": "alice@example.com",
  "role": "user",
  "created_at": "2024-01-01T12:00:00Z",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Error** `409 Conflict`:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "用户名或邮箱已被注册",
    "details": { "field": "email", "reason": "already_exists" }
  }
}
```

---

#### `POST /api/v1/auth/login` — 登录

- **认证**: 无需认证

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | 是 | 注册邮箱 |
| `password` | string | 是 | 密码 |

**Response `200 OK`**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 86400,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "alice",
    "email": "alice@example.com",
    "role": "user"
  }
}
```

**Error** `401 Unauthorized`:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "邮箱或密码错误" } }
```

---

#### `GET /api/v1/users/:id` — 获取用户信息

- **认证**: Bearer Token（仅能查看自己的信息，管理员可查看所有）

**Response `200 OK`**:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "alice",
  "email": "alice@example.com",
  "role": "user",
  "created_at": "2024-01-01T12:00:00Z"
}
```

**Error** `403 Forbidden`:

```json
{ "error": { "code": "FORBIDDEN", "message": "无权访问该用户信息" } }
```

---

#### `PUT /api/v1/users/:id` — 更新用户信息

- **认证**: Bearer Token（仅可更新自己的信息）

**Request Body**（至少提供一个字段）:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 否 | 新用户名 |
| `email` | string | 否 | 新邮箱 |

**Response `200 OK`**: (同 GET 响应，增加 `updated_at`)

---

### 2.2 商品 (Products)

---

#### `GET /api/v1/products` — 商品列表

- **认证**: 无需认证

**Query Parameters**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | integer | 1 | 页码 |
| `page_size` | integer | 20 | 每页数量，最大 100 |
| `category` | string | — | 分类（精确匹配） |
| `search` | string | — | 搜索关键词（模糊匹配 name/description） |
| `min_price` | integer | — | 最低价格（分） |
| `max_price` | integer | — | 最高价格（分） |
| `sort` | string | `-created_at` | 可选: `price`, `-price`, `-created_at` |
| `status` | string | `active` | 商品状态: `active`, `inactive`, `deleted` |

**Response `200 OK`**:

```json
{
  "data": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "无线蓝牙耳机",
      "description": "高品质降噪耳机，续航 30 小时",
      "price": 19900,
      "stock": 50,
      "category": "electronics",
      "image_url": "https://example.com/images/headphone.jpg",
      "status": "active",
      "created_at": "2024-01-01T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 156,
    "total_pages": 8
  }
}
```

---

#### `GET /api/v1/products/:id` — 商品详情

- **认证**: 无需认证
- **Response `200 OK`**: (同列表中的单个商品，增加 `updated_at`)

---

#### `POST /api/v1/products` — 创建商品（管理员）

- **认证**: Bearer Token (role=admin)

**Request Body**:

| 字段 | 类型 | 必填 | 校验规则 |
|------|------|------|----------|
| `name` | string | 是 | 最大 200 字符 |
| `description` | string | 是 | 商品描述 |
| `price` | integer | 是 | 价格（分），> 0 |
| `stock` | integer | 是 | 库存数量，>= 0 |
| `category` | string | 是 | 分类 |
| `image_url` | string | 否 | 商品图片 URL（可选） |

**Response `201 Created`**: (同商品详情)

---

#### `PUT /api/v1/products/:id` — 更新商品（管理员）

- **认证**: Bearer Token (role=admin)
- **请求体**: 同创建，字段均为可选（至少提供一个）
- **响应**: `200 OK` + 更新后的商品详情

---

#### `DELETE /api/v1/products/:id` — 删除商品（管理员）

- **认证**: Bearer Token (role=admin)
- **实现**: 软删除 (status → `deleted`)

**Response `200 OK`**:

```json
{ "message": "商品已删除", "id": "660e8400-e29b-41d4-a716-446655440001" }
```
