#### **SPI-Fraud Check**

# **Introduction**

This document is intended as a resource for developers to integrate Powertranz into a merchant's website . Tailored to technical audiences, this integration guide explains details about the simplified integration method optimized for Fraud Check support as a security layer.

# **E-Commerce with Fraud Check support**

The Powertranz gateway can send financial requests (authorization, sale, refund, or void) to the payment networks for cardholder authorization with Fraud check support .Fraud Check service, gives Merchants the ability to assess potential risks before advancing with authorization.

A Fraud check request can be a standalone request initiated to the spi/RiskMgmt endpoint or combined with financial transaction (initiated to the spi/auth or spi/sale endpoint).

Upon receiving the SPI request, Powertranz will validate it, and orchestrate steps required to complete the FraudCheck.

After this step, the Powertranz server will notify the merchant about the result and merchant will then decide whether or not to proceed with the financial request.

# **Available endpoints**

| **Endpoint** | **Description**                                                                            | **Type**      | **Method** | **URL**                     |
| ------------ | ------------------------------------------------------------------------------------------ | ------------- | ---------- | --------------------------- |
| **Alive**    | Gateway status                                                                             | Non-financial | GET        | <API Root>/api/alive        |
| **Auth**     | Performs an authorization securing funds for later capture.                                | Financial     | POST       | <API Root>/api/spi/auth     |
| **Sale**     | Performs an authorization with capture.                                                    | Financial     | POST       | <API Root>/api/spi/sale     |
| **RiskMgmt** | Non-financial transaction. Used for 3DS authentication, to tokenize a card or Fraud Check. | Non-financial | POST       | <API Root>/api/spi/riskmgmt |
| **Payment**  | Payment Completion.                                                                        | Financial     | POST       | <API Root>/api/spi/payment  |
| **Capture**  | Captures a previously authorized transaction.                                              | Financial     | POST       | <API Root>/api/capture      |
| **Refund**   | Refunds a previously authorized transaction                                                | Financial     | POST       | <API Root>/api/refund       |
| **Void**     | Void an authorization.                                                                     | Financial     | POST       | <API Root>/api/void         |

In general, within the simplified implementation, the merchant will make two calls to endpoints in the Powertranz API.

1. The first request (Auth, Sale, or RiskMgmt) will initiate the process and return an authorization SpiToken for subsequent requests.
2. If the first request is successful, subsequent requests can be made to the "Payment", "Capture", "Void" and "Refund" endpoints to either cancel or complete the transaction as required.

An ecommerce request with Fraud Check support is initiated by the merchant using "Auth/Sale/RiskMgmt" REST endpoints with **FraudCkeck** flag enabled.

- The "/Auth" or "/Sale" financial request endpoint is called when the merchant **intends** to perform an online financial request after fraud check. If the Payment completion is successful, an Auth requires a follow-up capture to be sent to complete the transaction. A sale will authorize and flag the transaction to be captured without an additional call.
- "/RiskMgmt" non-financial request endpoint is called only when the merchant **intends** to perform fraud check before proceeding with any other request using other endpoints.

# **Transaction Flow**

| **Step** | **Description**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.1**  | The merchant web server displays the finalized shopping cart to the cardholder.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **1.2**  | The cardholder checks out.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **1.3**  | The merchant sends an Auth, Sale, or RiskMgmt request to the Powertranz server with FraudCheck flag enabled.                                                                                                                                                                                                                                                                                                                                                                           |
| **1.4**  | The Powertranz server, authenticates and validates the request coming from the merchant, generates a SpiToken, and replies to the merchant server with **RedirectData** and an IsoResponseCode of SP4. If the request does not pass basic validation an error response will be returned.                                                                                                                                                                                               |
| **1.5**  | The RedirectData can be found within the response received from the Auth/Sale/RiskMgmt endpoint. The response received contains an HTML form accompanied by JavaScript code. This code is then injected into an iFrame which resides within the cardholder's browser, to initiate the subsequent steps .The iFrame, functioning within the cardholder's browser ,facilitates fraud check and interacts with the Powertranz server.                                                     |
| **1.6**  | Powertranz responds with FraudCheck results to the merchant server via the cardholder browser. Note that this is not a financial transaction and is the result of Fraud Check only.                                                                                                                                                                                                                                                                                                    |
| **1.7**  | Based on the response and risk level, the merchant determines if they want to proceed with next steps.                                                                                                                                                                                                                                                                                                                                                                                 |
| **1.8**  | Powertranz returns the Auth/Sale payment response to the merchant server.                                                                                                                                                                                                                                                                                                                                                                                                              |
| **1.9**  | The merchant server then displays the final results to the cardholder browser. If the merchant originally called a Sale, the financial transaction is now complete, and then, following settlement (not controlled by PowerTranz), the cardholder will be billed, and the merchant account will be credited. If the merchant called an Auth, there will be a hold on funds, but a Capture must be sent when the merchant is ready to finalize the transaction and bill the cardholder. |

_General SPI Flow_

!SPI Flow

_General SPI Flow_

# **Example**

You can use a tool like Postman to call the endpoint with the body you created.

> 📘
>
> ### **Requirements**
>
> Make sure to include the required headers.

Here is an example of the body that you might use:

_If using postman, the variable "{{$guid}}" generates a unique GUID._

JSON

```
{
    "TransactionIdentifier": "{{$guid}}",//GUID needs to be unique example: 40511888-ad35-4bba-8dcb-214f493e185c
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
       "MerchantResponseUrl": "{{MERCHANT_URL}}" //Please use a valid URL. PowerTranz's servers will send
         //a response to the merchant response url. It's a callback URL.
    }
}
```

If the request is successful ( Not a **Call Center** request) , you should receive a similar response to below:

Response

```
{
    "TransactionType": 1,
    "Approved": false,
    "TransactionIdentifier": "Your GUID from the payload should be reflected here",
    "TotalAmount": 1.00,
    "CurrencyCode": "840",
    "IsoResponseCode": "SP4",
    "ResponseMessage": "SPI Preprocessing complete",
    "OrderIdentifier": "Your order identifier from the payload should be reflected here",
    "RedirectData": "<!DOCTYPE html><html><head></head><body>...</body></html>",
    "SpiToken": "SPI TOKEN will be here"
}
```

The IsoResponseCode SP4, as referenced here, lets us know that the SPI Preprocessing was completed. The response generated from the /Auth endpoint will include "RedirectData" and a "SpiToken" that you will need for subsequent requests.

> 📘
>
> ### **Note !**
>
> **It's important to note that the "SpiToken" lives for 5 minutes**

![](https://files.readme.io/c1ccd36-image.png)

As step 1.4 (image above) indicated, we must take the RedirectData from the response and present it to the cardholder browser (CHB) inside an iFrame.

We can achieve this by rendering in the cardholder browser the following HTML code.

HTML

```
<iframe srcdoc="{RedirectData}" frameborder="0" width="100%" height="500"></iframe>
```

Once the RedirectData has been bound to the Iframe, the process will continue in the context of the Iframe.

- FraudCheck request is submitted form card holder browser (iFrame) to Fraud Service and response is redirects to Powertranz.
- Powertranz continues processing and sends response to the "MerchantResponseUrl" posted originally in spi/Auth payload. The response received looks like below:

JSON

```
{
  "TransactionType": 1,
  "Approved": false,
  "TransactionIdentifier": "Your Transaction ID",
  "TotalAmount": 1.00,
  "CurrencyCode": "840",
  "CardBrand": "Visa",
  "FraudCheck": {
      "FcProvider": "Kount",
      "ResponseCode": "FC0",
      "FcResponseCode": "A",
      "FcScore": "32",
      "FcDetails": {
        "ErrorCode": "0",
        "Version": "0695",
        "Mode": "Q",
        "TransactionId": "K8Y00CCN4WVM",
        "MerchantId": "440004",
        "SessionId": "caa50ab3905a4e46b01778b39052afde",
        "OrderNumber": "Your order identifier from the payload should be reflected here",
        "Auto": "A",
        "Score": "32",
        "Geox": "US",
        "Brand": "VISA",
        "Velo": "0",
        "Vmax": "0",
        "Network": "A",
        "Kaptcha": "Y",
        "Proxy": "N",
        "Emails": "1",
        "HttpCountry": "US",
        "TimeZone": "180",
        "Cards": "1",
        "PcRemote": "N",
        "Devices": "1",
        "DeviceLayers": "2D5332442A..23EA1C3E4B.88292C253E.174472D91F",
        "MobileForwarder": "N",
        "VoiceDevice": "N",
        "LocalTime": "2023-08-22 13:18",
        "FingerPrint": "9F7454A9D7E14EFAB1C66BEAAB0E278D",
        "Flash": "N",
        "Language": "EN",
        "Country": "BM",
        "Cookies": "Y",
        "MobileDevice": "N",
        "Site": "DEFAULT",
        "IPAddress": "192.172.239.242",
        "IPAddressLatitude": "32.3201",
        "IPAddressLongitude": "-64.7376",
        "IPAddressCountry": "BM",
        "IPAddressRegion": "Hamilton",
        "IPAddressCity": "Hamilton",
        "IPAddressOrganization": "Communications Ltd",
        "DateDeviceFirstSeen": "2023-08-22",
        "UserAgentString": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
        "DeviceScreenResolution": "1080x1920",
        "OS": "Windows 10"
      },
      "FcTransId": "K8Y00CCN4WVM"
    }
  },
  "PanToken": "87a2c47ikbw9qqv4pda7syb5rgl1qaxnlec2s1w2ag6rmx021",
  "ExternalIdentifier": "your external identifier",
  "OrderIdentifier": "Your order identifier from the payload should be reflected here",
  "SpiToken": "1b24q6x9u2by90vxsohpz6r93t51esecyyakgslzbc388r1nzl-iseenw5eb"
}
```

At this stage, we are done with the cardholder browser and are currently located at point 1.6 from the integration flow.

![](https://files.readme.io/29b17bc-image.png)

We must now remove the iFrame as its lifespan is intended to be very short-lived and transparent to the cardholder browser.

Please note, iFrames, for security reasons, block multiple things, such as session cookies, etc... So it is essential to include a redirect to exit the iFrame.

For example, the following code would exit out of the "MerchantResponseUrl" in the iFrame to your final result page.

MerchantResponseUrl.html

```
<script>
window.onload = redirectParent;
function redirectParent() {
window.parent.location = './AuthenticationResult'; //Adjust the page location to your needs
}
</script>
```

# **What's next?**

If we take a look at the response , it contains FcResponseCode as "A" (Approved) .We can interpret this response as successful Fraud check .

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
