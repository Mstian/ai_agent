# 极简电商 RESTful API 设计

> 版本：v1 | 基础 URL：`/api/v1` | 格式：JSON | 认证：Bearer Token

---

## 资源总览（4 个资源，共 17 个端点）

| # | 资源 | 端点数 | 核心操作 |
|---|------|--------|----------|
| 1 | **商品** | 4 | 浏览、搜索、详情、分类 |
| 2 | **用户** | 3 | 注册、登录、个人信息 |
| 3 | **购物车** | 5 | 查看、添加、改数量、删除单/全部 |
| 4 | **订单** | 5 | 创建、列表、详情、取消、确认收货 |

---

## 统一响应格式

```json
// 成功
{ "code": 0, "message": "ok", "data": { ... } }

// 失败
{ "code": 40001, "message": "参数错误", "errors": [{ "field": "price", "message": "价格不能为负" }] }
```

| HTTP 状态码 | 说明 |
|-------------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 参数错误 / 业务校验失败 |
| 401 | 未认证 / Token 无效 |
| 404 | 资源不存在 |
| 409 | 冲突（如重复注册） |

---

## 1. 商品（Products）— 无需认证

### 端点列表

| 方法 | 路径 | 说明 | 请求体 | 响应体 |
|------|------|------|--------|--------|
| `GET` | `/products` | 分页查询商品列表 | **Query:** `?page=1&pageSize=20&category=手机&keyword=华为&sortBy=price&sortOrder=asc` | `{ page, pageSize, total, items: [{ productId, name, price, imageUrl, sales, stock, rating }] }` |
| `GET` | `/products/:id` | 获取商品详情 | — | `{ productId, name, description, price, originalPrice, imageUrls, stock, sales, specs, createdAt }` |
| `GET` | `/categories` | 获取分类树 | — | `{ items: [{ categoryId, name, slug, children: [...] }] }` |

### 请求示例

```bash
# 分页查询（带过滤和排序）
GET /api/v1/products?page=1&pageSize=20&category=手机&keyword=华为&sortBy=price&sortOrder=asc

# 商品详情
GET /api/v1/products/p-001

# 分类列表
GET /api/v1/categories
```

### 响应示例

```json
// GET /products
{
  "code": 0, "message": "ok",
  "data": {
    "page": 1, "pageSize": 20, "total": 56,
    "items": [
      {
        "productId": "p-001",
        "name": "华为 Mate 60",
        "price": 6999.00,
        "imageUrl": "https://example.com/images/huawei-60.jpg",
        "sales": 10240,
        "stock": 500,
        "rating": 4.8
      }
    ]
  }
}

// GET /products/p-001
{
  "code": 0, "message": "ok",
  "data": {
    "productId": "p-001",
    "name": "华为 Mate 60",
    "description": "搭载麒麟芯片...",
    "price": 6999.00,
    "originalPrice": 7999.00,
    "imageUrls": ["https://.../1.jpg", "https://.../2.jpg"],
    "stock": 500,
    "sales": 10240,
    "rating": 4.8,
    "specs": [
      { "name": "颜色", "values": ["黑", "白", "紫"] },
      { "name": "存储", "values": ["256G", "512G"] }
    ],
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

---

## 2. 用户（Users）— 部分需认证

### 端点列表

| 方法 | 路径 | 说明 | 请求体 | 响应体 |
|------|------|------|--------|--------|
| `POST` | `/auth/register` | 用户注册（无需认证） | `{ username, email, password }` | `{ userId, username, email, createdAt }` |
| `POST` | `/auth/login` | 用户登录（无需认证） | `{ login(用户名或邮箱), password }` | `{ accessToken, refreshToken, user: { userId, username, email } }` |
| `GET` | `/users/me` | 获取当前用户信息（需认证） | — | `{ userId, username, email, phone, avatar, createdAt }` |
| `PUT` | `/users/me` | 更新个人信息（需认证） | `{ phone?, avatar? }` | `{ userId, username, email, phone, avatar, updatedAt }` |

### 请求示例

```bash
# 注册
POST /api/v1/auth/register
Content-Type: application/json
{ "username": "张三", "email": "zhangsan@example.com", "password": "abc123456" }

# 登录
POST /api/v1/auth/login
Content-Type: application/json
{ "login": "zhangsan@example.com", "password": "abc123456" }

# 获取个人信息
GET /api/v1/users/me
Authorization: Bearer <token>

# 更新个人信息
PUT /api/v1/users/me
Authorization: Bearer <token>
Content-Type: application/json
{ "phone": "13800138000" }
```

### 响应示例

```json
// POST /auth/register → 201
{
  "code": 0, "message": "ok",
  "data": { "userId": "u-001", "username": "张三", "email": "zhangsan@example.com", "createdAt": "2024-01-01T00:00:00Z" }
}

// POST /auth/login → 200
{
  "code": 0, "message": "ok",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "dGhpcyBpcyBhIHJlZnJl...",
    "user": { "userId": "u-001", "username": "张三", "email": "zhangsan@example.com" }
  }
}
```

---

## 3. 购物车（Cart）— 全部需认证

### 端点列表

| 方法 | 路径 | 说明 | 请求体 | 响应体 |
|------|------|------|--------|--------|
| `GET` | `/cart` | 查看购物车 | — | `{ items: [{ cartItemId, productId, name, price, imageUrl, quantity, stock, selected }], totalPrice, totalCount }` |
| `POST` | `/cart/items` | 添加商品到购物车 | `{ productId, quantity }` | `{ cartItemId, productId, quantity }` |
| `PUT` | `/cart/items/:id` | 修改商品数量 | `{ quantity }` | `{ cartItemId, productId, quantity }` |
| `DELETE` | `/cart/items/:id` | 删除购物车中的某商品 | — | `{ message: "ok" }` |
| `DELETE` | `/cart` | 清空购物车 | — | `{ message: "ok" }` |

### 请求示例

```bash
# 查看购物车
GET /api/v1/cart
Authorization: Bearer <token>

# 添加商品
POST /api/v1/cart/items
Authorization: Bearer <token>
Content-Type: application/json
{ "productId": "p-001", "quantity": 2 }

# 修改数量
PUT /api/v1/cart/items/ci-001
Authorization: Bearer <token>
Content-Type: application/json
{ "quantity": 3 }

# 删除一项
DELETE /api/v1/cart/items/ci-001
Authorization: Bearer <token>

# 清空购物车
DELETE /api/v1/cart
Authorization: Bearer <token>
```

### 响应示例

```json
// GET /cart
{
  "code": 0, "message": "ok",
  "data": {
    "items": [
      {
        "cartItemId": "ci-001",
        "productId": "p-001",
        "name": "华为 Mate 60",
        "price": 6999.00,
        "imageUrl": "https://.../1.jpg",
        "quantity": 2,
        "stock": 500,
        "selected": true
      }
    ],
    "totalPrice": 13998.00,
    "totalCount": 2
  }
}
```

---

## 4. 订单（Orders）— 全部需认证

### 端点列表

| 方法 | 路径 | 说明 | 请求体 | 响应体 |
|------|------|------|--------|--------|
| `POST` | `/orders` | 创建订单（从购物车结算） | `{ addressId, remark?, itemIds? }` | `{ orderId, orderNo, status, payAmount, items, address, createdAt }` |
| `GET` | `/orders` | 分页查询订单列表 | **Query:** `?page=1&pageSize=10&status=paid` | `{ page, pageSize, total, items: [{ orderId, orderNo, status, payAmount, createdAt }] }` |
| `GET` | `/orders/:id` | 获取订单详情 | — | `{ orderId, orderNo, status, payAmount, freight, items, address, remark, createdAt }` |
| `POST` | `/orders/:id/cancel` | 取消订单 | — | `{ orderId, status: "cancelled" }` |
| `POST` | `/orders/:id/receive` | 确认收货 | — | `{ orderId, status: "received" }` |

> 订单状态流转：`pending` → `paid` → `shipped` → `received` → `completed`
>
> 取消：仅在 `pending` 或 `paid` 状态可取消

### 请求示例

```bash
# 创建订单（从购物车结算）
POST /api/v1/orders
Authorization: Bearer <token>
Content-Type: application/json
{
  "addressId": "addr-001",
  "remark": "请尽快发货",
  "itemIds": ["ci-001", "ci-002"]
}

# 查询订单列表
GET /api/v1/orders?page=1&pageSize=10&status=pending
Authorization: Bearer <token>

# 订单详情
GET /api/v1/orders/o-001
Authorization: Bearer <token>

# 取消订单
POST /api/v1/orders/o-001/cancel
Authorization: Bearer <token>

# 确认收货
POST /api/v1/orders/o-001/receive
Authorization: Bearer <token>
```

### 响应示例

```json
// POST /orders → 201
{
  "code": 0, "message": "ok",
  "data": {
    "orderId": "o-001",
    "orderNo": "202401011200001",
    "status": "pending",
    "payAmount": 13998.00,
    "freight": 0.00,
    "items": [
      {
        "orderItemId": "oi-001",
        "productId": "p-001",
        "name": "华为 Mate 60",
        "price": 6999.00,
        "quantity": 2,
        "subtotal": 13998.00
      }
    ],
    "address": {
      "receiverName": "张三",
      "receiverPhone": "13800138000",
      "fullAddress": "广东省深圳市南山区科技园A栋101"
    },
    "remark": "请尽快发货",
    "createdAt": "2024-01-01T12:00:00Z"
  }
}
```

---

## 附录：数据模型

### Product（商品）

| 字段 | 类型 | 说明 |
|------|------|------|
| productId | string (UUID) | 商品 ID |
| name | string | 商品名称 |
| description | string | 商品描述 |
| price | number | 当前售价 |
| originalPrice | number | 原价 |
| imageUrls | string[] | 图片 URL 数组 |
| stock | integer | 库存数量 |
| sales | integer | 累计销量 |
| rating | number | 评分（0-5） |
| specs | object[] | 规格选项 |
| categoryId | string | 所属分类 |
| status | enum | `on_sale` / `off_shelf` |
| createdAt | string (ISO 8601) | 创建时间 |

### User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | string (UUID) | 用户 ID |
| username | string | 用户名 |
| email | string | 邮箱 |
| password | string (hash) | 加密密码 |
| phone | string | 手机号 |
| avatar | string | 头像 URL |
| createdAt | string | 创建时间 |

### CartItem（购物车项）

| 字段 | 类型 | 说明 |
|------|------|------|
| cartItemId | string (UUID) | 购物车项 ID |
| userId | string | 所属用户 |
| productId | string | 商品 ID |
| quantity | integer | 数量 |
| selected | boolean | 是否选中 |
| createdAt | string | 添加时间 |

### Order（订单）

| 字段 | 类型 | 说明 |
|------|------|------|
| orderId | string (UUID) | 订单 ID |
| orderNo | string | 可读订单号 |
| userId | string | 下单用户 |
| status | enum | `pending` / `paid` / `shipped` / `received` / `completed` / `cancelled` |
| totalAmount | number | 商品总价 |
| freight | number | 运费 |
| payAmount | number | 实付金额 |
| remark | string | 备注 |
| addressSnapshot | object | 收货地址快照 |
| createdAt | string | 创建时间 |

### OrderItem（订单项）

| 字段 | 类型 | 说明 |
|------|------|------|
| orderItemId | string (UUID) | 订单项 ID |
| orderId | string | 所属订单 |
| productId | string | 商品 ID |
| name | string | 商品名称快照 |
| price | number | 下单时单价 |
| quantity | integer | 数量 |
| subtotal | number | 小计 |
| imageUrl | string | 商品图片快照 |
