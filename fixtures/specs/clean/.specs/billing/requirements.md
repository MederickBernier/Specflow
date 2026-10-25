# billing: requirements

## R1: Pay for an order
priority: must
status: approved

- Given a signed-in shopper with items in the cart
- When they pay
- Then an order is created and marked paid
