# billing: requirements

## R1: Pay for an order
priority: must
status: approved

- Given a signed-in shopper with items in the cart
- When they pay
- Then an order is created and marked paid

## R2: Refund an order
priority: should
status: approved

- Given a paid order
- When the shopper asks for a refund
- Then the order is marked refunded
