#### **Financial Authorization Result**

After examining the cardholder 3DS2 authentication and fraud check results, you can now make the decision to proceed with the financial transaction. Depending on your integration method, you can complete the payment by making a call to either **/api/spi/payment** or **/api/payment** and providing the required **spitoken**.

Powertranz will initiate a financial transaction request to the issuing bank and will return the obtained results to the merchant web application. the successful response will look like the sample below.

JSON

```
{
  "TransactionType": 1,
  "Approved": true,
  "AuthorizationCode": "123456",
  "TransactionIdentifier": "Your TransactionIdentifier from the payload should be reflected here",
  "TotalAmount": 1.00,
  "CurrencyCode": "840",
  "RRN": "307522590956",
  "CardBrand": "Visa",
  "IsoResponseCode": "00",
  "ResponseMessage": "Transaction is approved",
  "PanToken": "1glhrirtqittv5cslkx5awmljha8cjrntjjnawagki4czpg9qap",
  "OrderIdentifier": "Your order identifier from the payload should be reflected here"
}
```

# **Understanding the Differences Between Auth and Sale endpoints**

### **Authorization**

The authorization endpoint gets approval from the cardholder's bank to reserve the funds for the specified transaction amount on their card. Merchants can initiate an authorization request using the "/Auth" financial request endpoint. If the transaction is successful, a follow-up request to the "/Payment" endpoint is required. Finally, a call to the "/Capture" endpoint must be made to capture the funds. Without the final call to the "/Capture" endpoint, no funds will be settled and the hold on funds on the card will eventually expire.

### **Sale**

The sale endpoint is similar to authorization but does not require an additional call to the capture endpoint. The sale process both authorizes and flags the transaction for capture when processed. This means that payment will be captured, and the cardholder will be billed after calling the "/Payment" endpoint. An additional call to the payment gateway is not required to compete the financial transaction.

# **Additional Endpoints to Manage Financial Transactions**

### **Capture**

Using the "/Capture" endpoint, merchants can finalize a preauthorized payment request. This allows the merchant's application to request the actual transfer of funds from the cardholder's account to the merchant's account (settlement) .

This gives the merchant flexibility in managing their payments. For example, they can choose to capture the funds immediately after authorization, or they can delay the capture until they are ready to fulfill the order or or when goods or services are ready to be provided.

### **Refund**

When a merchant needs to issue a refund, they should make a request to "/Refund" endpoint. If the refund is approved, the funds are transferred from the merchant's account back to the customer's account.

### **Void**

Before the payment is captured or settled, merchants may decide to cancel the transaction. in this case they can call "/Void" endpoint to cancel a financial message and release the hold on funds. In some scenarios, you maybe able to void a captured or settled transaction. Once a transaction has been voided, it is considered closed and no further modifications can be done.

> 📘
>
> ### **Good to Know !**
>
> Powertranz supports partial capture and refund, allowing you to, for instance, authorize $100 and then choose to capture only $40 . You cannot void a transaction partially.

> 🚧
>
> ### **Note !**
>
> Partial capture, partial refund and void after capture, are features that should be supported by acquiring banks. please coordinate with Powertranz support team if you intend to leverage these features.
