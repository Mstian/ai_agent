# 电商系统 RESTful API 设计文档

> 版本：v1.0 | 协议：OpenAPI 3.0 | 基础 URL：`https://api.example.com/v1`

## 1. 整体架构

### 1.1 资源模型

- 用户 (User) → 地址 (Address)、收藏 (Favorite)、优惠券 (Coupon)、评价 (Review)
- 商品 (Product) → 分类 (Category)、SKU (SKU)、规格 (Spec)
- 购物车 (Cart) → 购物车项 (CartItem)
- 订单 (Order) → 订单项 (OrderItem)、支付 (Payment)、物流 (Shipment)

### 1.2 端点列表速查

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/register | 用户注册 |
| POST | /auth/login | 用户登录 |
| POST | /auth/refresh | 刷新令牌 |
| POST | /auth/logout | 退出登录 |
| GET | /users/me | 获取当前用户 |
| PUT | /users/me | 更新用户信息 |
| GET | /users/me/addresses | 地址列表 |
| POST | /users/me/addresses | 新增地址 |
| PUT | /users/me/addresses/:id | 更新地址 |
| DELETE | /users/me/addresses/:id | 删除地址 |
| GET | /users/me/favorites | 收藏列表 |
| POST | /users/me/favorites | 添加收藏 |
| DELETE | /users/me/favorites/:id | 取消收藏 |
| GET | /users/me/coupons | 我的优惠券 |
| GET | /categories | 分类树形列表 |
| GET | /categories/:id | 分类详情 |
| GET | /products | 商品列表（分页） |
| GET | /products/:id | 商品详情 |
| GET | /products/:id/skus | SKU 列表 |
| GET | /products/:id/reviews | 商品评价 |
| POST | /products/:id/reviews | 发表评价 |
| GET | /cart | 查看购物车 |
| POST | /cart/items | 添加商品到购物车 |
| PUT | /cart/items/:id | 修改购物车项 |
| DELETE | /cart/items/:id | 删除购物车项 |
| DELETE | /cart | 清空购物车 |
| POST | /orders | 创建订单 |
| GET | /orders | 订单列表 |
| GET | /orders/:id | 订单详情 |
| PUT | /orders/:id/cancel | 取消订单 |
| PUT | /orders/:id/confirm | 确认收货 |
| POST | /payments | 发起支付 |
| GET | /payments/:id | 支付状态 |
| POST | /payments/:id/refund | 申请退款 |
| GET | /shipments/:id | 物流详情 |
| GET | /shipments/:id/tracking | 物流追踪 |

---