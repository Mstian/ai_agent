### 2.3 购物车 (Cart)

> 购物车是**用户级**资源。每个登录用户有且仅有一个购物车，在首次访问时自动创建。

---

#### `GET /api/v1/cart` — 查看购物车

- **认证**: Bearer Token

**Response `200 OK`**:

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440010",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "items": [
    {
      "product_id": "660e8400-e29b-41d4-a716-446655440001",
      "product_name": "无线蓝牙耳机",
      "price": 19900,
      "quantity": 2,
      "subtotal": 39800
    },
    {
      "product_id": "660e8400-e29b-41d4-a716-446655440002",
      "product_name": "机械键盘",
      "price": 49900,
      "quantity": 1,
      "subtotal": 49900
    }
  ],
  "total": 89700,
  "created_at": "2024-01-01T12:00:00Z",
  "updated_at": "2024-01-02T10:00:00Z"
}
```

---

#### `POST /api/v1/cart/items` — 添加商品到购物车

- **认证**: Bearer Token

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `product_id` | string(UUID) | 是 | 商品 ID |
| `quantity` | integer | 是 | 数量，>= 1 |

**行为**: 若商品已在购物车中，数量**累加**。后端需校验商品存在且 `status=active`。

**Response `200 OK`**:

```json
{
  "product_id": "660e8400-e29b-41d4-a716-446655440001",
  "product_name": "无线蓝牙耳机",
  "price": 19900,
  "quantity": 3,
  "subtotal": 59700
}
```

**Error** `404 Not Found`:

```json
{ "error": { "code": "NOT_FOUND", "message": "商品不存在或已下架" } }
```

---

#### `PUT /api/v1/cart/items/:productId` — 修改购物车商品数量

- **认证**: Bearer Token

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `quantity` | integer | 是 | 新数量，>= 1（设为 0 请使用 DELETE） |

**行为**: 直接覆盖数量（非累加）。

**Response `200 OK`**: (同添加的响应)

**Error** `404 Not Found`:

```json
{ "error": { "code": "NOT_FOUND", "message": "购物车中不存在该商品" } }
```

---

#### `DELETE /api/v1/cart/items/:productId` — 从购物车移除商品

- **认证**: Bearer Token
- **Response `200 OK`**:

```json
{ "message": "商品已从购物车移除", "product_id": "660e8400-e29b-41d4-a716-446655440001" }
```

---

#### `DELETE /api/v1/cart` — 清空购物车

- **认证**: Bearer Token
- **Response `200 OK`**:

```json
{ "message": "购物车已清空" }
```

---

### 2.4 订单 (Orders)

---

#### `POST /api/v1/orders` — 创建订单（下单）

- **认证**: Bearer Token
- **描述**: 将当前购物车所有商品转为订单。下单后自动清空购物车。

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `shipping_address` | object | 是 | 收货地址 |
| `shipping_address.name` | string | 是 | 收货人姓名 |
| `shipping_address.phone` | string | 是 | 手机号 |
| `shipping_address.province` | string | 是 | 省 |
| `shipping_address.city` | string | 是 | 市 |
| `shipping_address.district` | string | 是 | 区 |
| `shipping_address.detail` | string | 是 | 详细地址 |
| `note` | string | 否 | 备注，最大 500 字符 |

**后端内部逻辑**:

```
1. 校验购物车非空 → 400
2. 校验每个商品存在且 status=active
3. 校验库存充足 (quantity <= stock) → 409
4. 扣减库存（原子操作）
5. 创建订单（status = 'pending'）
6. 创建订单商品快照 (OrderItem)
7. 清空购物车
8. 返回订单信息
```

**Response `201 Created`**:

```json
{
  "id": "880e8400-e29b-41d4-a716-446655440020",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "items": [
    {
      "product_id": "660e8400-e29b-41d4-a716-446655440001",
      "product_name": "无线蓝牙耳机",
      "price": 19900,
      "quantity": 2,
      "subtotal": 39800
    }
  ],
  "total": 39800,
  "shipping_address": {
    "name": "张三",
    "phone": "13800138000",
    "province": "广东省",
    "city": "深圳市",
    "district": "南山区",
    "detail": "科技园南区 A 栋 1201"
  },
  "note": "请在工作日配送",
  "created_at": "2024-01-02T10:00:00Z"
}
```

**Error** `409 Conflict` — 库存不足:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "以下商品库存不足",
    "details": [
      {
        "product_id": "660e8400-e29b-41d4-a716-446655440001",
        "product_name": "无线蓝牙耳机",
        "requested": 10,
        "available": 3
      }
    ]
  }
}
```

**Error** `400 Bad Request`:

```json
{ "error": { "code": "EMPTY_CART", "message": "购物车为空，无法下单" } }
```

---

#### `GET /api/v1/orders` — 订单列表

- **认证**: Bearer Token

**Query Parameters**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | integer | 1 | 页码 |
| `page_size` | integer | 20 | 每页数量 |
| `status` | string | — | 过滤状态: `pending`, `confirmed`, `shipped`, `completed`, `cancelled` |

**Response `200 OK`**:

```json
{
  "data": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440020",
      "status": "pending",
      "total": 39800,
      "item_count": 2,
      "created_at": "2024-01-02T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 12,
    "total_pages": 1
  }
}
```

---

#### `GET /api/v1/orders/:id` — 订单详情

- **认证**: Bearer Token（仅能查看自己的订单，管理员可查看所有）

**Response `200 OK`**:

```json
{
  "id": "880e8400-e29b-41d4-a716-446655440020",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "items": [
    {
      "product_id": "660e8400-e29b-41d4-a716-446655440001",
      "product_name": "无线蓝牙耳机",
      "price": 19900,
      "quantity": 2,
      "subtotal": 39800
    }
  ],
  "total": 39800,
  "shipping_address": {
    "name": "张三",
    "phone": "13800138000",
    "province": "广东省",
    "city": "深圳市",
    "district": "南山区",
    "detail": "科技园南区 A 栋 1201"
  },
  "note": "请在工作日配送",
  "created_at": "2024-01-02T10:00:00Z",
  "updated_at": "2024-01-02T10:00:00Z"
}
```

---

#### `PUT /api/v1/orders/:id/status` — 更新订单状态

- **认证**: Bearer Token（根据角色限制操作）

**状态流转**:

```
[pending] ──> [confirmed] ──> [shipped] ──> [completed]
    │
    └──> [cancelled]  (仅 pending/confirmed 可取消)
```

| 操作 | 角色 | 说明 |
|------|------|------|
| `pending → cancelled` | 用户或管理员 | 用户主动取消 |
| `pending → confirmed` | 管理员 | 确认订单 |
| `confirmed → shipped` | 管理员 | 标记发货 |
| `shipped → completed` | 管理员 | 标记完成 |

**Request Body**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | string | 是 | 目标状态 |
| `reason` | string | 否 | 取消原因（仅 cancelled 时需要） |

**Response `200 OK`**:

```json
{
  "id": "880e8400-e29b-41d4-a716-446655440020",
  "status": "cancelled",
  "updated_at": "2024-01-02T12:00:00Z"
}
```

**Error** `400 Bad Request` — 非法的状态流转:

```json
{ "error": { "code": "INVALID_STATUS_TRANSITION", "message": "不允许从 shipped 转为 cancelled" } }
```
