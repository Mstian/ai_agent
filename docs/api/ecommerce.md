# 电商系统 API 设计 v1

> 版本：v1 | 前缀：`/api/v1` | 协议：HTTPS | 格式：JSON

---

## 整体架构

### 资源模型概览

```
User (用户) ──1:N──> Order (订单) ──1:N──> OrderItem (订单项)
    │                                           │
    │                                           │
    ├──1:1──> Cart (购物车) ──1:N──> CartItem (购物车项)
    │                                           │
    └──1:N──> Payment (支付记录)                │
                                               │
Product (商品) <───────────────────────────────┘
```

### 路由总表

| 模块 | 资源路径 | 说明 |
|------|---------|------|
| 认证 | `/api/v1/auth/*` | 注册、登录、刷新 Token |
| 用户 | `/api/v1/users/*` | 用户信息管理 |
| 商品 | `/api/v1/products/*` | 商品 CRUD、搜索、分类 |
| 购物车 | `/api/v1/cart/*` | 购物车项管理 |
| 订单 | `/api/v1/orders/*` | 订单 CRUD、状态流转 |
| 支付 | `/api/v1/payments/*` | 支付发起、回调、查询 |

---

## 认证方式

### Bearer Token（简版 JWT）

- 所有 **需要认证** 的接口在请求头中携带：
  ```
  Authorization: Bearer <access_token>
  ```
- Token 类型：JWT，包含 `userId`, `role`, `exp` 等声明
- Access Token 有效期：**24 小时**
- Refresh Token 有效期：**7 天**（用于无感续期）

### 认证相关端点

- `POST /api/v1/auth/register` — 注册（无需认证）
- `POST /api/v1/auth/login` — 登录（无需认证）
- `POST /api/v1/auth/refresh` — 刷新 Token（无需认证，请求体传 refreshToken）

---

## 端点定义

### 1. 认证（Auth）

#### 1.1 用户注册

```
POST /api/v1/auth/register
Content-Type: application/json

Request Body:
{
  "username": "string (3~32 位字母数字下划线, required)",
  "email":    "string (合法邮箱, required)",
  "password": "string (8~64 位, required)"
}

Response 201:
{
  "code": 0,
  "message": "ok",
  "data": {
    "userId": "string (UUID)",
    "username": "string",
    "email": "string",
    "createdAt": "string (ISO 8601)"
  }
}

Response 409 (用户名或邮箱已存在):
{
  "code": 40901,
  "message": "用户名或邮箱已被注册",
  "errors": [
    { "field": "email", "message": "该邮箱已被注册" }
  ]
}
```

#### 1.2 用户登录

```
POST /api/v1/auth/login
Content-Type: application/json

Request Body:
{
  "login":    "string (用户名或邮箱, required)",
  "password": "string (required)"
}

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "string (JWT, 24h 有效)",
    "refreshToken": "string (JWT, 7d 有效)",
    "expiresIn": 86400,
    "user": {
      "userId": "string",
      "username": "string",
      "email": "string"
    }
  }
}

Response 401:
{
  "code": 40101,
  "message": "用户名/邮箱或密码错误"
}
```

#### 1.3 刷新 Token

```
POST /api/v1/auth/refresh
Content-Type: application/json

Request Body:
{
  "refreshToken": "string (required)"
}

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "string (新 JWT)",
    "refreshToken": "string (新 refresh token)",
    "expiresIn": 86400
  }
}

Response 401:
{
  "code": 40102,
  "message": "refreshToken 无效或已过期"
}
```

---

### 2. 用户（Users）

#### 2.1 获取当前用户信息

```
GET /api/v1/users/me
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "userId": "string",
    "username": "string",
    "email": "string",
    "phone": "string | null",
    "avatar": "string (URL) | null",
    "createdAt": "string",
    "updatedAt": "string"
  }
}
```

#### 2.2 更新当前用户信息

```
PUT /api/v1/users/me
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body (至少一项):
{
  "phone": "string (11 位手机号, optional)",
  "avatar": "string (URL, optional)"
}

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "userId": "string",
    "username": "string",
    "email": "string",
    "phone": "string | null",
    "avatar": "string | null",
    "updatedAt": "string"
  }
}
```

#### 2.3 获取收货地址列表

```
GET /api/v1/users/me/addresses
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "page": 1,
    "pageSize": 20,
    "total": 2,
    "items": [
      {
        "addressId": "string",
        "receiverName": "string",
        "receiverPhone": "string",
        "province": "string",
        "city": "string",
        "district": "string",
        "detailAddress": "string",
        "isDefault": false,
        "createdAt": "string"
      }
    ]
  }
}
```

#### 2.4 新增收货地址

```
POST /api/v1/users/me/addresses
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body:
{
  "receiverName": "string (required)",
  "receiverPhone": "string (11 位手机号, required)",
  "province": "string (required)",
  "city": "string (required)",
  "district": "string (required)",
  "detailAddress": "string (required)",
  "isDefault": "boolean (default: false)"
}

Response 201:
{
  "code": 0,
  "message": "ok",
  "data": {
    "addressId": "string",
    "receiverName": "string",
    "receiverPhone": "string",
    "province": "string",
    "city": "string",
    "district": "string",
    "detailAddress": "string",
    "isDefault": false,
    "createdAt": "string"
  }
}
```

#### 2.5 删除收货地址

```
DELETE /api/v1/users/me/addresses/{addressId}
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok"
}

Response 404:
{
  "code": 40401,
  "message": "地址不存在"
}
```

---

### 3. 商品（Products）

#### 3.1 分页查询商品列表

```
GET /api/v1/products
Query Parameters:
  page      | integer (default: 1, min: 1)
  pageSize  | integer (default: 20, min: 1, max: 100)
  category  | string (商品分类 slug, optional)
  keyword   | string (搜索关键词, optional)
  minPrice  | number (最低价格, optional)
  maxPrice  | number (最高价格, optional)
  sortBy    | string (排序字段: price | sales | createdAt, default: createdAt)
  sortOrder | string (排序方向: asc | desc, default: desc)

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "page": 1,
    "pageSize": 20,
    "total": 156,
    "items": [
      {
        "productId": "string",
        "name": "string",
        "description": "string (简短描述)",
        "price": 99.99,
        "originalPrice": 129.99,
        "imageUrl": "string (主图 URL)",
        "sales": 1024,
        "stock": 500,
        "category": {
          "categoryId": "string",
          "name": "string",
          "slug": "string"
        },
        "rating": 4.5,
        "createdAt": "string"
      }
    ]
  }
}
```

#### 3.2 获取商品详情

```
GET /api/v1/products/{productId}

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "productId": "string",
    "name": "string",
    "description": "string (完整描述, 支持 Markdown)",
    "price": 99.99,
    "originalPrice": 129.99,
    "imageUrls": ["string (多图数组)"],
    "stock": 500,
    "sales": 1024,
    "category": {
      "categoryId": "string",
      "name": "string",
      "slug": "string"
    },
    "rating": 4.5,
    "specs": [
      { "name": "颜色", "values": ["黑色", "白色"] },
      { "name": "尺寸", "values": ["S", "M", "L"] }
    ],
    "createdAt": "string",
    "updatedAt": "string"
  }
}

Response 404:
{
  "code": 40402,
  "message": "商品不存在"
}
```

#### 3.3 获取商品分类列表

```
GET /api/v1/categories

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "categoryId": "string",
        "name": "string",
        "slug": "string",
        "description": "string",
        "parentId": "string | null",
        "children": [ ... ] (递归嵌套)
      }
    ]
  }
}
```

---

### 4. 购物车（Cart）

> 购物车与用户绑定，所有操作均需认证。

#### 4.1 获取购物车

```
GET /api/v1/cart
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "cartId": "string",
    "items": [
      {
        "cartItemId": "string",
        "productId": "string",
        "name": "string",
        "imageUrl": "string",
        "price": 99.99,
        "quantity": 2,
        "stock": 500,
        "selected": true,
        "createdAt": "string"
      }
    ],
    "totalPrice": 199.98,
    "totalCount": 2
  }
}
```

#### 4.2 添加商品到购物车

```
POST /api/v1/cart/items
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body:
{
  "productId": "string (required)",
  "quantity": "integer (required, min: 1, max: 99)"
}

Response 201:
{
  "code": 0,
  "message": "ok",
  "data": {
    "cartItemId": "string",
    "productId": "string",
    "quantity": 2,
    "selected": true
  }
}

Response 400 (库存不足):
{
  "code": 40001,
  "message": "商品库存不足",
  "errors": [
    { "field": "stock", "message": "当前库存仅剩 3 件" }
  ]
}
```

#### 4.3 更新购物车项数量

```
PUT /api/v1/cart/items/{cartItemId}
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body:
{
  "quantity": "integer (required, min: 1, max: 99)"
}

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "cartItemId": "string",
    "productId": "string",
    "quantity": 3,
    "selected": true
  }
}

Response 404:
{
  "code": 40403,
  "message": "购物车项不存在"
}
```

#### 4.4 切换购物车项选中状态

```
PATCH /api/v1/cart/items/{cartItemId}/select
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body:
{
  "selected": "boolean (required)"
}

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "cartItemId": "string",
    "selected": false
  }
}
```

#### 4.5 批量选中/取消选中

```
PATCH /api/v1/cart/select-all
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body:
{
  "selected": "boolean (required)"
}

Response 200:
{
  "code": 0,
  "message": "ok"
}
```

#### 4.6 删除购物车项

```
DELETE /api/v1/cart/items/{cartItemId}
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok"
}
```

#### 4.7 清空购物车

```
DELETE /api/v1/cart
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok"
}
```

---

### 5. 订单（Orders）

> 订单状态机：`pending` → `paid` → `shipped` → `received` → `completed`
>
> 取消流程：`pending` / `paid` → `cancelled`

#### 5.1 创建订单（从购物车结算）

```
POST /api/v1/orders
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body:
{
  "addressId": "string (required, 收货地址 ID)",
  "remark": "string (可选备注, max: 200)",
  "items": [
    { "cartItemId": "string (传空数组则结算所有选中项)" }
  ]
}

Response 201:
{
  "code": 0,
  "message": "ok",
  "data": {
    "orderId": "string",
    "orderNo": "string (可读性好的订单号, 如: 202501011200001)",
    "status": "pending",
    "totalAmount": 199.98,
    "freight": 0.00,
    "payAmount": 199.98,
    "items": [
      {
        "orderItemId": "string",
        "productId": "string",
        "name": "string",
        "imageUrl": "string",
        "price": 99.99,
        "quantity": 2,
        "subtotal": 199.98
      }
    ],
    "address": {
      "receiverName": "string",
      "receiverPhone": "string",
      "fullAddress": "string (省市区详细地址拼接)"
    },
    "remark": "string",
    "createdAt": "string",
    "expiresAt": "string (未支付订单自动取消时间, 30 分钟后)"
  }
}

Response 400 (部分商品库存不足):
{
  "code": 40002,
  "message": "部分商品库存不足，订单创建失败",
  "errors": [
    { "field": "productId", "message": "商品 XXX 库存不足" }
  ]
}
```

#### 5.2 分页查询订单列表

```
GET /api/v1/orders
Authorization: Bearer <access_token>
Query Parameters:
  page     | integer (default: 1)
  pageSize | integer (default: 10, max: 50)
  status   | string (过滤: pending | paid | shipped | received | completed | cancelled, optional)

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "page": 1,
    "pageSize": 10,
    "total": 25,
    "items": [
      {
        "orderId": "string",
        "orderNo": "string",
        "status": "paid",
        "payAmount": 199.98,
        "itemCount": 2,
        "firstImageUrl": "string (第一个商品的图片)",
        "createdAt": "string"
      }
    ]
  }
}
```

#### 5.3 获取订单详情

```
GET /api/v1/orders/{orderId}
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "orderId": "string",
    "orderNo": "string",
    "status": "paid",
    "totalAmount": 199.98,
    "freight": 0.00,
    "payAmount": 199.98,
    "items": [
      {
        "orderItemId": "string",
        "productId": "string",
        "name": "string",
        "imageUrl": "string",
        "price": 99.99,
        "quantity": 2,
        "subtotal": 199.98
      }
    ],
    "address": { ... },
    "remark": "string",
    "createdAt": "string",
    "expiresAt": "string"
  }
}

Response 404:
{
  "code": 40404,
  "message": "订单不存在"
}
```

#### 5.4 取消订单

```
POST /api/v1/orders/{orderId}/cancel
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "orderId": "string",
    "status": "cancelled",
    "cancelledAt": "string"
  }
}

Response 400 (订单状态不允许取消):
{
  "code": 40003,
  "message": "当前订单状态不允许取消"
}
```

#### 5.5 确认收货

```
POST /api/v1/orders/{orderId}/receive
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "orderId": "string",
    "status": "received",
    "receivedAt": "string"
  }
}

Response 400:
{
  "code": 40004,
  "message": "当前订单状态不允许确认收货"
}
```

---

### 6. 支付（Payments）

> 简版支付流程：客户端发起支付 → 返回支付链接/二维码 → 用户支付 → 支付回调通知 → 订单状态更新

#### 6.1 发起支付

```
POST /api/v1/payments
Authorization: Bearer <access_token>
Content-Type: application/json

Request Body:
{
  "orderId": "string (required, 待支付订单 ID)",
  "payMethod": "string (enum: wechat | alipay, required)"
}

Response 201:
{
  "code": 0,
  "message": "ok",
  "data": {
    "paymentId": "string",
    "orderId": "string",
    "payAmount": 199.98,
    "payMethod": "alipay",
    "status": "pending",
    "payUrl": "string (支付页面链接/二维码内容)",
    "expiresAt": "string (支付链接过期时间)"
  }
}

Response 400:
{
  "code": 40005,
  "message": "该订单已支付或已关闭"
}
```

#### 6.2 查询支付状态

```
GET /api/v1/payments/{paymentId}
Authorization: Bearer <access_token>

Response 200:
{
  "code": 0,
  "message": "ok",
  "data": {
    "paymentId": "string",
    "orderId": "string",
    "payAmount": 199.98,
    "payMethod": "alipay",
    "status": "success | pending | failed | expired",
    "paidAt": "string | null",
    "transactionNo": "string | null (第三方支付流水号)"
  }
}
```

#### 6.3 支付回调（Webhook，供支付平台调用）

```
POST /api/v1/payments/callback
Content-Type: application/json
X-Signature: string (签名校验)

Request Body:
{
  "paymentId": "string",
  "orderId": "string",
  "transactionNo": "string",
  "payAmount": 199.98,
  "status": "success",
  "paidAt": "string",
  "sign": "string (签名)"
}

Response 200:
{
  "code": 0,
  "message": "success"
}
```
