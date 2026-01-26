import json
from pathlib import Path


def url(path: str):
    query = None
    if '?' in path:
        base, q = path.split('?', 1)
        query = [dict(zip(['key', 'value'], part.split('=', 1))) for part in q.split('&') if part]
    else:
        base = path
    obj = {"raw": f"{{{{baseUrl}}}}/{path}", "host": ["{{baseUrl}}"], "path": base.split('/')}
    if query:
        obj["query"] = query
    return obj


def req(method, path, headers=None, body=None):
    request = {"method": method, "header": headers or [], "url": url(path)}
    if body is not None:
        request["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2)}
    return request


def event(exprs):
    lines = ["let data = null;", "try { data = pm.response.json(); } catch (err) {}"]
    for expr, var in exprs:
        lines.append(f"const v_{var} = {expr};")
        lines.append(f"if (v_{var}) {{ pm.collectionVariables.set('{var}', v_{var}); }}")
    return [{"listen": "test", "script": {"type": "text/javascript", "exec": lines}}]


def item(name, method, path, headers=None, body=None, exprs=None):
    payload = {"name": name, "request": req(method, path, headers, body), "response": []}
    if exprs:
        payload["event"] = event(exprs)
    return payload


def folder(name, items):
    return {"name": name, "item": items}


JSON_HEADER = [{"key": "Content-Type", "value": "application/json"}]


def auth(var="userToken"):
    return [{"key": "Authorization", "value": f"Bearer {{{{{var}}}}}"}]


def auth_json(var="userToken"):
    return auth(var) + JSON_HEADER


VARIABLES = [
    {"key": "baseUrl", "value": "https://nirv-ico.onrender.com"},
    {"key": "userName", "value": "Local Test User"},
    {"key": "userEmail", "value": "user+ico@example.com"},
    {"key": "userPassword", "value": "Password123!"},
    {"key": "mobileNumber", "value": "9998887777"},
    {"key": "countryCode", "value": "+91"},
    {"key": "userPin", "value": "1234"},
    {"key": "otpCode", "value": "000000"},
    {"key": "mobileOtp", "value": "000000"},
    {"key": "userId", "value": ""},
    {"key": "userToken", "value": ""},
    {"key": "addressId", "value": ""},
    {"key": "categoryId", "value": ""},
    {"key": "productId", "value": ""},
    {"key": "productSlug", "value": ""},
    {"key": "cartItemId", "value": ""},
    {"key": "orderId", "value": ""},
    {"key": "icoTransactionId", "value": ""},
    {"key": "adminEmail", "value": "admin@example.com"},
    {"key": "adminPassword", "value": "Password123!"},
    {"key": "adminToken", "value": ""},
    {"key": "paymentCode", "value": "PAYMENT_SUCCESS"},
    {"key": "phonePeTransactionId", "value": "pp-demo-123"},
]

AUTH_ITEMS = [
    item(
        "Signup Combined (Email + Mobile)",
        "POST",
        "api/auth/signup/combined-init",
        JSON_HEADER,
        {
            "name": "{{userName}}",
            "email": "{{userEmail}}",
            "mobile": "{{mobileNumber}}",
            "countryCode": "{{countryCode}}",
            "password": "{{userPassword}}",
        },
        [("data && data.userId", "userId")],
    ),
    item(
        "Signup Email - Init",
        "POST",
        "api/auth/signup/email-init",
        JSON_HEADER,
        {"name": "{{userName}}", "email": "{{userEmail}}", "password": "{{userPassword}}"},
        [("data && data.userId", "userId")],
    ),
    item(
        "Signup Mobile - Init",
        "POST",
        "api/auth/signup/mobile-init",
        JSON_HEADER,
        {"name": "{{userName}}", "mobile": "{{mobileNumber}}", "countryCode": "{{countryCode}}"},
        [("data && data.userId", "userId")],
    ),
    item(
        "Signup - Verify OTP",
        "POST",
        "api/auth/signup/verify",
        JSON_HEADER,
        {"userId": "{{userId}}", "otp": "{{otpCode}}", "type": "email"},
        [("data && data.token", "userToken"), ("data && data._id", "userId")],
    ),
    item(
        "Setup PIN",
        "POST",
        "api/auth/pin/setup",
        auth_json(),
        {"pin": "{{userPin}}"},
    ),
    item(
        "Login - Email & Password",
        "POST",
        "api/auth/login/email",
        JSON_HEADER,
        {"email": "{{userEmail}}", "password": "{{userPassword}}"},
        [("data && data.token", "userToken"), ("data && data._id", "userId")],
    ),
    item(
        "Login - Mobile Init (OTP)",
        "POST",
        "api/auth/login/mobile-init",
        JSON_HEADER,
        {"mobile": "{{mobileNumber}}", "countryCode": "{{countryCode}}"},
        [("data && data.userId", "userId")],
    ),
    item(
        "Login - Mobile Verify (OTP)",
        "POST",
        "api/auth/login/mobile-verify",
        JSON_HEADER,
        {"mobile": "{{mobileNumber}}", "countryCode": "{{countryCode}}", "otp": "{{mobileOtp}}"},
        [("data && data.token", "userToken"), ("data && data._id", "userId")],
    ),
    item(
        "Login - OTP Init (Email or Mobile)",
        "POST",
        "api/auth/login/otp-init",
        JSON_HEADER,
        {"identifier": "{{userEmail}}", "countryCode": "{{countryCode}}"},
        [("data && data.userId", "userId")],
    ),
    item(
        "Login - OTP Verify (Email or Mobile)",
        "POST",
        "api/auth/login/otp-verify",
        JSON_HEADER,
        {"identifier": "{{userEmail}}", "countryCode": "{{countryCode}}", "otp": "{{otpCode}}"},
        [("data && data.token", "userToken"), ("data && data._id", "userId")],
    ),
    item(
        "Login - PIN",
        "POST",
        "api/auth/login/pin",
        JSON_HEADER,
        {"identifier": "{{userEmail}}", "countryCode": "{{countryCode}}", "pin": "{{userPin}}"},
        [("data && data.token", "userToken"), ("data && data._id", "userId")],
    ),
]

USER_ITEMS = [
    item("List Addresses", "GET", "api/user/addresses", auth()),
    item(
        "Add Address",
        "POST",
        "api/user/addresses",
        auth_json(),
        {
            "label": "Home",
            "fullName": "{{userName}}",
            "phone": "{{mobileNumber}}",
            "line1": "221B Baker Street",
            "city": "London",
            "state": "London",
            "postalCode": "NW16XE",
            "country": "GB",
            "isDefault": True,
        },
        [("(Array.isArray(data) && data[0] && data[0]._id) ? data[0]._id : null", "addressId")],
    ),
    item(
        "Update Address",
        "PUT",
        "api/user/addresses/{{addressId}}",
        auth_json(),
        {"label": "Home Updated", "landmark": "Near Station"},
    ),
    item("Set Default Address", "PATCH", "api/user/addresses/{{addressId}}/default", auth()),
    item("Delete Address", "DELETE", "api/user/addresses/{{addressId}}", auth()),
]

CATALOG_ITEMS = [
    item("List Products", "GET", "api/products?limit=12"),
    item("List Categories (Public)", "GET", "api/products/categories/list"),
    item("Get Product by Id or Slug", "GET", "api/products/{{productId}}"),
]

CART_ITEMS = [
    item("Get Cart", "GET", "api/cart", auth()),
    item(
        "Add Item to Cart",
        "POST",
        "api/cart/items",
        auth_json(),
        {"productId": "{{productId}}", "quantity": 1},
        [("data && data.items && data.items[0] && data.items[0]._id", "cartItemId")],
    ),
    item(
        "Update Cart Item Quantity",
        "PATCH",
        "api/cart/items/{{cartItemId}}",
        auth_json(),
        {"quantity": 2},
    ),
    item("Remove Cart Item", "DELETE", "api/cart/items/{{cartItemId}}", auth()),
    item("Clear Cart", "DELETE", "api/cart", auth()),
]

ORDER_ITEMS = [
    item(
        "Create Order (PhonePe)",
        "POST",
        "api/orders",
        auth_json(),
        {
            "shippingAddress": {
                "name": "{{userName}}",
                "line1": "221B Baker Street",
                "city": "London",
                "state": "London",
                "postalCode": "NW16XE",
                "country": "GB",
                "phone": "{{mobileNumber}}",
            },
            "billingAddress": {
                "name": "{{userName}}",
                "line1": "221B Baker Street",
                "city": "London",
                "state": "London",
                "postalCode": "NW16XE",
                "country": "GB",
                "phone": "{{mobileNumber}}",
            },
            "paymentMethod": "phonepe",
            "shippingFee": 0,
            "taxes": 0,
        },
        [("data && data.order && data.order._id", "orderId")],
    ),
    item("Get My Orders", "GET", "api/orders", auth()),
    item("Get Order by Id", "GET", "api/orders/{{orderId}}", auth()),
]

ICO_ITEMS = [
    item("Public Token Price", "GET", "api/ico/price"),
    item("My ICO Summary", "GET", "api/ico/summary", auth()),
    item("ICO Transactions History", "GET", "api/ico/transactions", auth()),
    item(
        "Buy Tokens (PhonePe)",
        "POST",
        "api/ico/buy",
        auth_json(),
        {"tokenAmount": 10},
        [("data && data.transaction && data.transaction._id", "icoTransactionId")],
    ),
    item(
        "Sell Tokens",
        "POST",
        "api/ico/sell",
        auth_json(),
        {"tokenAmount": 5},
        [("data && data.transaction && data.transaction._id", "icoTransactionId")],
    ),
]

ADMIN_ITEMS = [
    item(
        "Admin Login (Email & Password)",
        "POST",
        "api/auth/login/email",
        JSON_HEADER,
        {"email": "{{adminEmail}}", "password": "{{adminPassword}}"},
        [("data && data.token", "adminToken")],
    ),
    item("List Categories (Admin)", "GET", "api/admin/categories", auth("adminToken")),
    item(
        "Create Category",
        "POST",
        "api/admin/categories",
        auth_json("adminToken"),
        {"name": "Electronics", "description": "Devices and accessories"},
        [("data && data._id", "categoryId")],
    ),
    item(
        "Update Category",
        "PUT",
        "api/admin/categories/{{categoryId}}",
        auth_json("adminToken"),
        {"description": "Electronics and gadgets", "isActive": True},
    ),
    item("Delete Category", "DELETE", "api/admin/categories/{{categoryId}}", auth("adminToken")),
    item("List Products (Admin)", "GET", "api/admin/products", auth("adminToken")),
    item(
        "Create Product",
        "POST",
        "api/admin/products",
        auth_json("adminToken"),
        {
            "name": "Sample Phone",
            "description": "Mid-range device",
            "price": 49999,
            "salePrice": 44999,
            "currency": "INR",
            "stock": 25,
            "sku": "PHONE-001",
            "category": "{{categoryId}}",
            "attributes": [
                {"key": "color", "value": "black"},
                {"key": "storage", "value": "128GB"},
            ],
            "images": [
                {"url": "https://example.com/phone.jpg", "altText": "Phone"},
            ],
            "isActive": True,
        },
        [("data && data._id", "productId"), ("data && data.slug", "productSlug")],
    ),
    item(
        "Update Product",
        "PUT",
        "api/admin/products/{{productId}}",
        auth_json("adminToken"),
        {"price": 45999, "stock": 30, "isActive": True},
    ),
    item("Delete Product", "DELETE", "api/admin/products/{{productId}}", auth("adminToken")),
    item("List Orders (Admin)", "GET", "api/orders/admin", auth("adminToken")),
    item(
        "Update Order Status (Admin)",
        "PATCH",
        "api/orders/admin/{{orderId}}",
        auth_json("adminToken"),
        {"status": "confirmed", "paymentStatus": "paid"},
    ),
]

PAYMENT_ITEMS = [
    item(
        "PhonePe Callback - Order",
        "POST",
        "api/payments/phonepe/callback",
        JSON_HEADER,
        {
            "code": "{{paymentCode}}",
            "merchantTransactionId": "{{orderId}}",
            "transactionId": "{{phonePeTransactionId}}",
            "amount": 1000,
        },
    ),
    item(
        "PhonePe Callback - ICO",
        "POST",
        "api/payments/phonepe/callback",
        JSON_HEADER,
        {
            "code": "{{paymentCode}}",
            "merchantTransactionId": "{{icoTransactionId}}",
            "transactionId": "{{phonePeTransactionId}}",
            "amount": 1000,
        },
    ),
]

ITEMS = [
    folder("Health", [item("Health Check", "GET", "health")]),
    folder("Auth - Signup & Login", AUTH_ITEMS),
    folder("User Profile & Addresses", USER_ITEMS),
    folder("Catalog", CATALOG_ITEMS),
    folder("Cart", CART_ITEMS),
    folder("Orders", ORDER_ITEMS),
    folder("ICO", ICO_ITEMS),
    folder("Admin", ADMIN_ITEMS),
    folder("Payments", PAYMENT_ITEMS),
]

COLLECTION = {
    "info": {
        "name": "ICO Commerce - Full App Flow",
        "_postman_id": "f065e3f3-bcf9-4c38-9a8d-7c3e6abfacd0",
        "description": "End-to-end Postman collection for running the full signup, login, catalog, cart, order, ICO, admin, and payment callback flows against the backend. Start with Auth -> Signup Email Init and move down in order.",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "variable": VARIABLES,
    "item": ITEMS,
}


def main():
    target = Path("backend/ICO_Full_App_Flow.postman_collection.json")
    target.write_text(json.dumps(COLLECTION, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {target}")


if __name__ == "__main__":
    main()
