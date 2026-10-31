#### **SPI-Fraud Check - Call Center**

# **Introduction**

This document is intended as a resource for developers to integrate Powertranz into a merchant's website . Tailored to technical audiences, this integration guide explains details about the simplified integration method optimized for Fraud Check support as a security layer and performing financial transactions over the phone ( known as **Call Center**) .

# **E-Commerce with Fraud Check support Over the Phone**

The Powertranz gateway can send financial requests (authorization, sale, refund, or void) to the payment networks for cardholder authorization with Fraud check support .Fraud Check service, gives Merchants the ability to assess potential risks before advancing with authorization.

However, some customers may opt to place orders over the phone for various reasons, such as easier communication or a lack of online access. Powertranz accommodates this scenario, allowing transactions conducted over the phone, also known as Mail Order/Telephone Order (MOTO).

Upon receiving the SPI request with additional fields (to enable Call Center Processing), Powertranz will validate it and coordinate the necessary steps to complete the fraud check.

Following this process, the Powertranz server will inform the merchant of the result, and the Call Center analyst will then make the decision on whether or not to proceed with the financial request.

# **Available endpoints**

| **Endpoint** | **Description**                                                                            | **Type**      | **Method** | **URL**                     |
| ------------ | ------------------------------------------------------------------------------------------ | ------------- | ---------- | --------------------------- |
| **Alive**    | Gateway status                                                                             | Non-financial | GET        | <API Root>/api/alive        |
| **Auth**     | Performs an authorization securing funds for later capture.                                | Financial     | POST       | <API Root>/api/spi/auth     |
| **Sale**     | Performs an authorization with capture.                                                    | Financial     | POST       | <API Root>/api/spi/sale     |
| **RiskMgmt** | Non-financial transaction. Used for 3DS authentication , to tokenize a card or Fraud Check | Non-financial | POST       | <API Root>/api/spi/riskmgmt |
| **Payment**  | Payment Completion                                                                         | Financial     | POST       | <API Root>/api/spi/payment  |
| **Capture**  | Captures a previously authorized transaction.                                              | Financial     | POST       | <API Root>/api/capture      |
| **Refund**   | Refunds a previously authorized transaction                                                | Financial     | POST       | <API Root>/api/refund       |
| **Void**     | Void an authorization.                                                                     | Financial     | POST       | <API Root>/api/void         |

In general, within the simplified implementation, the merchant will make two calls to endpoints in the Powertranz API.

1. The first request (Auth, Sale, or RiskMgmt) will initiate the process and return an authorization SpiToken for subsequent requests.
2. If the first request is successful, subsequent requests can be made to the "Payment", "Capture", "Void" and "Refund" endpoints to either cancel or complete the transaction as required.

An ecommerce request with Fraud Check support for call center is initiated by the merchant using "Auth/Sale/RiskMgmt" REST endpoints with **FraudCheck** flag enabled and fraud check object populated.

- The "/Auth" or "/Sale" financial request endpoint is called when the merchant **intends** to perform an online financial request after fraud check. If the Payment completion is successful, an Auth requires a follow-up capture to be sent to complete the transaction. A sale will authorize and flag the transaction to be captured without an additional call.
- "/RiskMgmt" non-financial request endpoint is called only when the merchant **intends** to perform fraud check before proceeding with any other request using other endpoints.

# **Transaction Flow**

| **Step** | **Description**                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1.1**  | Cardholder/Merchant connects to Call Center and requests to complete and order over the phone. Call Center performs its due diligence and collects required information.                                                                                                                                                                                                                                                                               |
| **1.2**  | Call Center server sends an Auth, Sale, or RiskMgmt request to the Powertranz server with FraudCheck flag enabled and call center object populated to enable over the phone order processing                                                                                                                                                                                                                                                           |
| **1.3**  | The Powertranz server, authenticates and validates the request coming from the Call Center, generates a SpiToken. If the request does not pass basic validation an error response will be returned. Powertranz responds with FraudCheck results to the Call Center server . Note that this is not a financial transaction and is the result of Fraud Check only.                                                                                       |
| **1.4**  | Based on the response and risk level, the merchant determines if they want to proceed with completing the financial transaction. If RiskMgmt endpoint is called initially, the transaction stops at step 1.3 as a financial transaction cannot be performed after calling the RiskMgmt endpoint.                                                                                                                                                       |
| **1.5**  | Powertranz returns the Auth/Sale payment response to the Call Center server. If, originally Sale endpoint was called, the financial transaction is now complete, and then, following settlement (not controlled by Powertranz), the cardholder will be billed, and the merchant account will be credited. If Auth endpoint was called , there will be a hold on funds, but a Capture must be sent to finalize the transaction and bill the cardholder. |

_General SPI Flow (non 3DS)_

!General SPI Flow (non 3DS)

_General SPI Flow (non 3DS)_

# **Example**

You can use a tool like Postman to call the endpoint with the body you created.

> 📘
>
> ### **Requirements**
>
> Make sure to include the required headers.

Here is an example of the body that you might use. Please note, you are required to include additional fields in your request to prompt Powertranz to activate call center processing. Take note of the '**Provider**' '**Mode**' and '**CallerID**' (calling customer phone number) parameters in the following request, as they have indicated to Powertranz that this is a call center request.

JSON

```
  {
     "TransactionIdentifier": "{{$guid}}",//GUID needs to be unique example:40511888-ad35-4bba-8dcb-214f493e185c
     "TotalAmount": 1,
     "CurrencyCode": "840", //Numeric currency code (ISO 4217). 840 = USD
   	"fraudCheck":true,
     "Source": {
         "CardPan": "4012000000020006", //Test card
         "CardCvv": "323",
         "CardExpiration": "2310",
         "CardholderName": "John Doe"
     },
     "OrderIdentifier": "INT-{{$guid}}-Orc",
     "AddressMatch": false,
     "ExtendedData": {
       "fraudCheck": {
       "Provider": "Kount",
       "Mode": "PhoneOrder",
       "CallerId": "5551234567"
     }
     }
 }
```

If the request is successful you should receive a similar response to below:

Response

```
{
  "TransactionType": 1,
  "Approved": false,
  "TransactionIdentifier": "58e27efb-100a-4fa0-b54c-de01582a9bda",
  "CardBrand": "Visa",
  "IsoResponseCode": "FC0",
  "ResponseMessage": "Fraud check complete",
  "RiskManagement": {
    "FraudCheck": {
      "FcProvider": "Kount",
      "ResponseCode": "FC0",
      "FcResponseCode": "A",
      "FcScore": "34",
      "FcDetails": {
        "ErrorCode": "0",
        "Version": "0695",
        "Mode": "P",
        "TransactionId": "K60T0PQS741V",
        "MerchantId": "240001",
        "SessionId": "58e27efb100a4fa0b54cde01582a9bda",
        "OrderNumber": "Your order identifier from the payload should be reflected here",
        "Auto": "A",
        "Score": "34",
        "Geox": "US",
        "Brand": "VISA",
        "Velo": "0",
        "Vmax": "0",
        "Network": "N",
        "Kaptcha": "N",
        "Emails": "1",
        "Cards": "1",
        "Devices": "1"
      },
      "FcTransId": "K60T0PQS741V"
    }
  },
  "PanToken": "837a2c47ikbw9qqv4pda7syb5rgl1qaxnlec2s1w2ag6rmx02r",
  "ExternalIdentifier": "Your external identifier from the payload should be reflected here",
  "OrderIdentifier": "Your order identifier from the payload should be reflected here)",
  "SpiToken": "2a6gl3535wkk4h9vvroftf9xmyhsndvlmisfrd9stmlprlr5cm-iseenw5eb"
}
```

> 📘
>
> ### **Note !**
>
> **It's important to note that the "SpiToken" lives for 5 minutes**

If we take a look at the response , it contains IsoResponsemessage as "FC0" and FcResponseCode as "A" (Approved) .We can interpret this response as successful Fraud check .

To complete the payment portion of the transaction, merchants should call "/payment" and pass the SpiToken in an HTTP Post request. Powertranz will send the transaction to the relevant payment network and reply to the merchant.

> 📘
>
> ### **The payment completion request does not require PowerTranz-PowerTranzId and PowerTranz-PowerTranzPassword values in the header**

> 📘
>
> ### **The payment completion request will be declined by default if the FCResponseCode is D (Declined). Consequently, there is no need to initiate the payment completion if the Fraud Check is unsuccessful.**

For this request, the payload is just the SPI Token surrounded by quotes.

JSON

```
"SPI_TOKEN"
```

If successful, the response will look like this:

/Payment Response

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
    "PanToken": "1glhritqittv5cslkx5awmljha8cjrntjjnawagki4czpg9qa2",
    "OrderIdentifier": "Your order identifier from the payload should be reflected here"
}
```

Above response has approved flag as true and the IsoResponseCode is "00". We can interpret this response as an approved authorization.

#
