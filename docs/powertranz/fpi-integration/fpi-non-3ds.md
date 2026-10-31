#### **FPI non 3DS**

# **1. Introduction**

This document serves as a developer guide for integrating Powertranz payment processing into a merchant’s website. It outlines the integration method for non-3DS e-commerce transactions that does not use services that require any cardholder browser redirects.

If the merchant integration requires hosted payment pages (HPP), 3DS or Fraud Control, please refer to the SPI integration guides.

> ❗️
>
> ### **Notes!**
>
> Most banks require merchant integrations to use 3DS for added security. If you plan to process transactions without 3DS, please ensure your acquiring bank has approved this for your merchant account. If you’re unsure, please check with Powertranz Support before starting the integration.

# **Where to start?**

The Powertranz gateway sends financial requests (authorization, sale, capture, refund, or void) to the payment networks for cardholder authorization.

A financial request is initiated using the Auth, Sale, Capture, Refund, or Void endpoints.

A tokenize-only request is initiated using the RiskMgmt API with the Tokenize flag enabled.

| **Endpoint** | **Description**                                             | **Type**      | **Method** |                         |
| ------------ | ----------------------------------------------------------- | ------------- | ---------- | ----------------------- |
| **Alive**    | Gateway status                                              | Non-financial | GET        | <API Root>/api/alive    |
| **Auth**     | Performs an authorization securing funds for later capture. | Financial     | POST       | <API Root>/api/auth     |
| **Sale**     | Performs an authorization with capture.                     | Financial     | POST       | <API Root>/api/sale     |
| **RiskMgmt** | Non-financial transaction. Used to tokenize a card.         | Non-financial | POST       | <API Root>/api/RiskMgmt |
| **Capture**  | Captures a previously authorized transaction.               | Financial     | POST       | <API Root>/api/capture  |
| **Refund**   | Refunds a previously authorized transaction                 | Financial     | POST       | <API Root>/api/refund   |
| **Void**     | Voids an authorization.                                     | Financial     | POST       | <API Root>/api/void     |

# **Steps**

You can use a tool like Postman to call the endpoint with the body you created.

To initialize, we must send the POST request to the auth or to the sale endpoint.

> 📘
>
> ### **Note !**
>
> Make sure to include the required headers.

Here is an example of the body that you might use:

_If using postman, the variable "{{$guid}}" generates a unique GUID._

JSON

```
{
    "TransacctionIdentifier": "{{$guid}}",
    "TotalAmount": 1.50,
    "CurrencyCode": "840",
    "ThreeDSecure": false,
    "Source": {
        "CardPan": "4012000000020071",
        "CardCvv": "123",
        "CardExpiration": "2911",
        "CardholderName": "John Doe"
    },
    "OrderIdentifier": "{{$guid}}",
    "BillingAddress": {
        "FirstName": "John",
        "LastName": "Smith",
        "Line1": "1200 Whitewall Blvd.",
        "Line2": "Unit 15",
        "City": "Boston",
        "State": "NY",
        "PostalCode": "200341",
        "CountryCode": "840",
        "EmailAddress": "john.smith@gmail.com",
        "PhoneNumber": "211-345-6790"
    }
}
```

Sample response:

JSON

```
{
  "TransactionType": 1,
  "Approved": true,
  "AuthorizationCode": "123456",
  "TransactionIdentifier": "Your GUID from the payload should b erefelcted here",
  "TotalAmount": 1.50,
  "CurrencyCode": "840",
  "RRN": "223919793834",
  "CardBrand": " Visa",
  "IsoResponseCode": "00",
  "ResponseMessage": "Transaction is approved",
  "OrderIdentifier": "Your order identifier from the payload should be reflected here"
}
```

The " Approved" flag true and IsoResponseCode 00, as referenced here, lets us know that the Transaction is approved.

If an auth request was initiated, a capture is required as a follow-up transaction.

> 📘
>
> Partial voids are not supported. Only partial captures are supported.
>
> For certain acquirers a void is required after the partial capture to close the transaction. Please check with the support team for details on how to process partial captures.

#
