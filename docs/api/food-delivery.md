# 外卖系统 API 设计 v1

> 版本：v1 · 协议：RESTful · 编码：UTF-8
> 基础 URL：`/api/v1`
> 数据格式：`application/json`

---

## 整体架构

```
┌──────────────────────────────────────────────────────┐
│                      客户端                           │
├──────────────────────────────────────────────────────┤
│                Bearer Token (JWT)                     │
├──────────────────────────────────────────────────────┤
│                  /api/v1/*                            │
├──────────────────────────────────────────────────────┤
│  Auth  │  Users  │  Shops  │  Menus  │  Orders  │ Reviews │
└──────────────────────────────────────────────────────┘
```

### 资源模型关系

```
User ──1:N──> Order ──N:1──> Shop
Order ──N:N──> MenuItem (通过 OrderItem)
Order ──1:1──> Review
Shop ──1:N──> MenuItem
```

### 路由概览

| 资源       | 端点                                    | 方法      | 说明          |
|-----------|-----------------------------------------|-----------|---------------|
| **Auth**  | `/api/v1/auth/register`                 | POST      | 用户注册       |
|           | `/api/v1/auth/login`                    | POST      | 用户登录       |
|           | `/api/v1/auth/refresh`                  | POST      | 刷新 Token    |
| **Users** | `/api/v1/users/me`                      | GET       | 获取当前用户    |
|           | `/api/v1/users/me`                      | PUT       | 更新个人信息    |
| **Shops** | `/api/v1/shops`                         | GET       | 浏览商家列表    |
|           | `/api/v1/shops/:shopId`                 | GET       | 商家详情       |
| **Menus** | `/api/v1/shops/:shopId/menus`           | GET       | 商家菜单列表    |
|           | `/api/v1/menus/:menuId`                 | GET       | 菜单项详情     |
| **Orders**| `/api/v1/orders`                        | POST      | 创建订单       |
|           | `/api/v1/orders`                        | GET       | 我的订单列表    |
|           | `/api/v1/orders/:orderId`               | GET       | 订单详情       |
|           | `/api/v1/orders/:orderId/cancel`        | POST      | 取消订单       |
|           | `/api/v1/orders/:orderId/status`        | GET       | 订单状态跟踪    |
| **Reviews**| `/api/v1/orders/:orderId/review`       | POST      | 提交评价       |
|           | `/api/v1/orders/:orderId/review`        | GET       | 查看评价       |
|           | `/api/v1/shops/:shopId/reviews`         | GET       | 商家评价列表    |

---

## 认证方式

使用 **Bearer Token**（JWT），在请求头中携带：

```
Authorization: Bearer <token>
```

- Token 有效期为 **7 天**
- 刷新接口可获取新的 Token
- 认证失败返回 `401 Unauthorized`

---

## 端点定义

---

### 1. 用户认证与账户

#### POST /api/v1/auth/register

> 用户注册

**请求体**

```json
{
  "phone": "13800138000",
  "password": "abc123456",
  "name": "张三",
  "avatar": "https://example.com/avatar.png"
}
```

| 字段       | 类型   | 必填 | 说明                     |
|-----------|--------|------|--------------------------|
| phone     | string | 是   | 手机号，11 位数字         |
| password  | string | 是   | 密码，6~32 位字母数字组合 |
| name      | string | 是   | 昵称，2~20 位            |
| avatar    | string | 否   | 头像 URL                 |

**响应 `201 Created`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user": {
      "id": "u_20241201001",
      "phone": "138****8000",
      "name": "张三",
      "avatar": null,
      "createdAt": "2024-12-01T10:00:00Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**错误**

| 状态码 | 说明                          |
|-------|-------------------------------|
| 400   | 参数校验失败（手机号格式、密码强度等） |
| 409   | 手机号已注册                    |

---

#### POST /api/v1/auth/login

> 用户登录

**请求体**

```json
{
  "phone": "13800138000",
  "password": "abc123456"
}
```

**响应 `200 OK`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user": {
      "id": "u_20241201001",
      "phone": "138****8000",
      "name": "张三",
      "avatar": null
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**错误**

| 状态码 | 说明              |
|-------|-------------------|
| 401   | 手机号或密码错误    |

---

#### POST /api/v1/auth/refresh

> 刷新 Token（需要旧 Token 仍然有效）

**请求头**：`Authorization: Bearer <old_token>`

**响应 `200 OK`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

---

#### GET /api/v1/users/me

> 获取当前用户信息

**请求头**：`Authorization: Bearer <token>`

**响应 `200 OK`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "u_20241201001",
    "phone": "138****8000",
    "name": "张三",
    "avatar": null,
    "createdAt": "2024-12-01T10:00:00Z"
  }
}
```

---

#### PUT /api/v1/users/me

> 更新个人信息

**请求体**

```json
{
  "name": "张三丰",
  "avatar": "https://example.com/new-avatar.png"
}
```

**响应 `200 OK`** — 返回更新后的用户信息（同 GET /users/me 格式）

---

### 2. 商家

#### GET /api/v1/shops

> 浏览商家列表（分页 + 按品类过滤 + 按评分排序）

**Query 参数**

| 参数       | 类型   | 必填 | 默认值  | 说明                            |
|-----------|--------|------|--------|---------------------------------|
| page      | int    | 否   | 1      | 页码                            |
| pageSize  | int    | 否   | 20     | 每页条数（最大 50）              |
| category  | string | 否   | -      | 品类过滤（如：川菜、奶茶、快餐）   |
| sortBy    | string | 否   | rating | 排序字段：`rating` / `sales`     |
| order     | string | 否   | desc   | 排序方向：`asc` / `desc`         |
| keyword   | string | 否   | -      | 搜索关键词（商家名称模糊匹配）     |
| lat       | float  | 否   | -      | 纬度（用于距离排序）              |
| lng       | float  | 否   | -      | 经度（用于距离排序）              |

**响应 `200 OK`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "page": 1,
    "pageSize": 20,
    "total": 156,
    "items": [
      {
        "id": "s_20241201001",
        "name": "川味轩",
        "logo": "https://example.com/logo.png",
        "category": "川菜",
        "rating": 4.8,
        "monthlySales": 1234,
        "deliveryFee": 3.00,
        "minOrder": 20.00,
        "deliveryTime": "30-45分钟",
        "distance": 1.2,
        "tags": ["好评", "高销量"],
        "isOpen": true,
        "status": "open"
      }
    ]
  }
}
```

**说明**
- `distance` 字段仅在传递 `lat` / `lng` 时返回（单位：千米）
- `status` 取值：`open`（营业中）、`closed`（休息中）、`busy`（繁忙）

---

#### GET /api/v1/shops/:shopId

> 商家详情（含基本信息 + 统计）

**响应 `200 OK`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "s_20241201001",
    "name": "川味轩",
    "logo": "https://example.com/logo.png",
    "category": "川菜",
    "rating": 4.8,
    "ratingCount": 2560,
    "monthlySales": 1234,
    "deliveryFee": 3.00,
    "minOrder": 20.00,
    "deliveryTime": "30-45分钟",
    "address": "北京市朝阳区某某路100号",
    "phone": "010-88886666",
    "businessHours": "09:00-22:00",
    "announcement": "今日特惠，满30减5",
    "tags": ["好评", "高销量"],
    "isOpen": true,
    "status": "open",
    "menuCategories": ["招牌推荐", "主食", "小食", "饮品"]
  }
}
```

---

### 3. 菜单

#### GET /api/v1/shops/:shopId/menus

> 商家菜单列表（按分类分组）

**Query 参数**

| 参数       | 类型   | 必填 | 默认值 | 说明              |
|-----------|--------|------|--------|-------------------|
| category  | string | 否   | -      | 按分类过滤         |

**响应 `200 OK`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "shopId": "s_20241201001",
    "categories": [
      {
        "name": "招牌推荐",
        "items": [
          {
            "id": "m_202412010001",
            "name": "麻辣烫",
            "image": "https://example.com/menu1.png",
            "price": 28.00,
            "originalPrice": 35.00,
            "description": "精选肥牛、金针菇、豆腐皮",
            "spicyLevel": 3,
            "sales": 2045,
            "stock": 100,
            "isRecommended": true,
            "isAvailable": true
          }
        ]
      },
      {
        "name": "主食",
        "items": []
      }
    ]
  }
}
```

---

#### GET /api/v1/menus/:menuId

> 菜单项详情

**响应 `200 OK`**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "m_202412010001",
    "shopId": "s_20241201001",
    "name": "麻辣烫",
    "image": "https://example.com/menu1.png",
    "price": 28.00,
    "originalPrice": 35.00,
    "description": "精选肥牛、金针菇、豆腐皮",
    "spicyLevel": 3,
    "sales": 2045,
    "stock": 100,
    "isRecommended": true,
    "isAvailable": true,
    "category": "招牌推荐",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

---

### 4. 订单

#### POST /api/v1/orders

> 创建订单

**请求头**：`Authorization: Bearer <token>`

**请求体**

```json
{
  "shopId": "s_20241201001",
  "items": [
    {
      "menuId": "m_202412010001",
      "quantity": 2,
      "specs": {
        "spicy": "中辣",
        "extra": "加香菜"
      }
    },
    {
      "menuId": "m_202412010002",
      "quantity": 1,
      "specs": {}
    }
  ],
  "remark": "少放盐，尽快送达",
  "deliveryAddress": {
    "name": "张三",
    "phone": "13800138000",
    "address": "北京市朝阳区某某大厦A座1501",
    "lng": 116.397428,
    "lat": 39.90923
  },
  "deliveryTime": "2024-12-01T12:00:00Z"
}
```
