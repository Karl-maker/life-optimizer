#### **SPI-3DS-Fraud Check-HPP**

# **Introduction**

This document is intended as a resource for developers to integrate Powertranz into a merchant's website . Tailored to technical audiences, this integration guide explains details about the simplified 3DS integration method optimized for executing 3DS e-commerce transactions via HPP with Fraud Check support, as an additional security layer.

# **E-Commerce with 3D-Secure and HPP support + Fraud Check**

The Powertranz gateway supports EMV 3D-Secure versions 2.x for cardholder authentication, and sends financial requests (authorization, sale, refund, or void) to the payment networks for cardholder authorization .Powertranz Fraud Check service also, gives Merchants the ability to assess potential risks before advancing with transaction authentication and authorization. Adding to this, Powertranz's advanced HPP technology presents a secure avenue to collect payment details, encapsulating a comprehensive and secure transaction experience.

Merchants need to initiate a 3D-Secure Request using the Auth, Sale, or RiskMgmt API methods with the 3D-Secure flag enabled , Fraud Check flag enabled and HPP page details in the request . This will signal Powertranz that you would like to proceed with hosted payment page technology to gather cardholder details and you would like to do a FraudCheck followed by a 3DS authentication.

Upon receiving the request, Powertranz will complete request validation and also query the supported version of 3D-Secure . This inquiry is determined by the provided card number as well as the capabilities of the issuing bank maintained by Powertranz. As you are using simplified 3DS integration method with HPP and Fraud Check, Powertranz will connect to Fraud Check service, facilitate displaying the HPP form and handle the required interactions for a 3DS 2.0 authentication . The 3DS authentication may follow a Frictionless flow with/without device fingerprinting ,Challenge Flow with/without device fingerprinting, or if 3DS 2.0 is not supported for the card the transaction can be processed without authentication.

After the above steps the Powertranz server, will notify the merchant with authentication result and merchant will then decide whether or not to proceed with the financial request.

Note that if the card is suspected as fraud a 3DS authentication will not be performed.

> 📘
>
> ### **Note !**
>
> For **3DS it is required** that additional fields be sent for all 3DS authentication requests. Please use HPP Template that supports the following fields:
>
> **“CardholderName”** and
>
> **“EmailAddress”** and/or **“PhoneNumber”** (one of the two as a minimum)

# **Available endpoints**

| **Endpoint**          | **Description**                                                                    | **Type**      | **Method**                 | **URL**                     |
| --------------------- | ---------------------------------------------------------------------------------- | ------------- | -------------------------- | --------------------------- |
| **Alive**             | Gateway status                                                                     | Non-financial | GET                        | <API Root>/api/alive        |
| **Auth**              | Performs an authorization securing funds for later capture.                        | Financial     | POST                       | <API Root>/api/spi/auth     |
| **Sale**              | Performs an authorization with capture.                                            | Financial     | POST                       | <API Root>/api/spi/sale     |
| **RiskMgmt**          | Non-financial transaction. Used for 3DS authentication only or to tokenize a card. | Non-financial | POST                       | <API Root>/api/spi/riskmgmt |
| **Payment**           | Payment Completion for                                                             |
| 3DS pre-authenticated |
| sale or authorization |
| transactions.         | Financial                                                                          | POST          | <API Root>/api/spi/payment |
| **Capture**           | Captures a previously authorized transaction.                                      | Financial     | POST                       | <API Root>/api/capture      |
| **Refund**            | Refunds a previously authorized transaction                                        | Financial     | POST                       | <API Root>/api/refund       |
| **Void**              | Void an authorization.                                                             | Financial     | POST                       | <API Root>/api/void         |

In general, within the simplified 3DS implementation, the merchant will make two calls to endpoints in the Powertranz API.

1. The first request (Auth, Sale, or RiskMgmt) will initiate the Fraud Check and authentication process and return an authorization SpiToken for subsequent requests.
2. If the first request is successful, subsequent requests can be made to the "Payment", "Capture", "Void" and "Refund" endpoints to either cancel or complete the transaction as required.

A 3D-Secure authentication request with HPP and Fraud Check support is initiated by the merchant using "Auth/Sale/RiskMgmt" REST endpoints with the **3DS**and **FraudCkeck** flags enabled and including the **hosted page set and name**

- The "/Auth" or "/Sale" financial request endpoint is called when the merchant **intends** to perform an online financial request after 3DS Authentication. If the Payment completion is successful, an Auth requires a follow-up capture to be sent to complete the transaction. A sale will authorize and flag the transaction to be captured without an additional call.
- "/RiskMgmt" non-financial request endpoint is called only when the merchant **intends** to perform a Fraud Check and authenticate the cardholder (3DS2 Authentication only). In this case, authentication values returned from payment network, can be used to send financial requests using other endpoints.

> 📘
>
> ### **Note !**
>
> **The hosted page is created using the Powertranz merchant portal. Please contact oursupport team for details.**

# **Transaction Flow**

| **Step**                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Description**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.1**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The merchant web server displays the finalized shopping cart to the cardholder.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **1.2**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The cardholder checks out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **1.3**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The merchant sends an Auth, Sale, or RiskMgmt request to the PowerTranz server with the 3DS and FraudCheck flag enabled, which includes a **hosted page set and name**. The relevant cardholder and payment details will be collected on the hosted page.                                                                                                                                                                                                                                                                             |
| **1.4**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The Powertranz server, authenticates and validates the request coming from the merchant, generates a SpiToken, and replies to the merchant server with **RedirectData** and an IsoResponseCode of SP4. If the request does not pass basic validation an error response will be returned.                                                                                                                                                                                                                                              |
| **1.5**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The RedirectData can be found within the response received from the Auth/Sale/RiskMgmt endpoint. The response received contains an HTML form accompanied by JavaScript code. This code is then injected into an iFrame which resides within the cardholder's browser, to initiate the subsequent steps .The iFrame, functioning within the cardholder's browser displays the HPP form,facilitates Fraud Check, interacts with Powertranz and appropriate 3DS servers, depending on each step and specific type of 3DS authentication. |
| Throughout this process, there are two potential authentication scenarios: a fully "Frictionless" flow or the presentation of a challenge window (known as the Challenge flow) to the cardholder. Once the process is successfully completed, the iFrame is redirected to the MerchantResponseUrl, effectively restoring control of the flow to the Merchant application. For a practical example and code implementation, please consult the Recipe Section. |
| **1.6**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Powertranz responds with the 3DS authentication and FraudCheck results to the merchant server via the cardholder browser. Note that this is not a financial transaction and is the result of the 3DS authentication and FraudCheck only. If the card does not support 3DS authentication an isoResponseCode of SP1 will be returned .If the FraudCheck is not successful ( Suspected Fraud ) the 3DS authentication will not be performed and the FraudCheck only result will be returned to the merchant server.                     |
| **1.7**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Based on the response, the merchant determines if they want to proceed with payment completion. If the merchant chooses to proceed with the transaction, a payment completion is sent using the SpiToken and sending a Payment request. The payment completion needs to be sent within 5 minutes. After 5 minutes, the SpiToken will be unavailable. The authorization request is then sent from the PowerTranz server to the processor and to the issuing bank.                                                                      |
| **1.8**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Powertranz returns the Auth/Sale payment response to the merchant server.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **1.9**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The merchant server then displays the final results to the cardholder browser. If the merchant originally called a Sale, the financial transaction is now complete, and then, following settlement (not controlled by Powertranz), the cardholder will be billed, and the merchant account will be credited. If the merchant called an Auth, there will be a hold on funds, but a Capture must be sent when the merchant is ready to finalize the transaction and bill the cardholder.                                                |

_General SPI Flow_

!General SPI Flow

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
    "TransactionIdentifier": "{{$guid}}", //GUID needs to be unique example: 40511888-ad35-4bba-8dcb-214f493e185c
    "TotalAmount": 1,
    "CurrencyCode": "840", //Numeric currency code (ISO 4217). 840 = USD
    "ThreeDSecure": true,
  	"fraudCheck":true,
    "OrderIdentifier": "INT-{{$guid}}-Orc",
    "AddressMatch": false,
    "ExtendedData": {
        "ThreeDSecure": {
            "ChallengeWindowSize": 4,
            "ChallengeIndicator": "01"
        },
      "HostedPage": {
            "PageSet": "YourPageSet",
            "PageName": "YourPageName"
        },
        "MerchantResponseUrl": "{{MERCHANT_URL}}" //Please use a valid URL. PowerTranz's servers will send
         //a response to the merchant response url. It's a callback URL.
    }
}
```

> 📘
>
> ### **Important!**
>
> Pages created in Powertranz Merchant Portal **MUST** contain the ‘PTZ/’ prefix in the **Page Set** request. If this prefix is missing, the transaction will fail, and the Hosted Payment Page will not be loaded correctly.
>
> ![](https://files.readme.io/55af3f22b445740c0172e1a6eda746a661a0302239e6fb5475ad0a927741cdbc-image.png)

If the request is successfully validated, it should produce a similar response to this one:

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

The IsoResponseCode SP4, as referenced here, lets you know that the SPI Preprocessing was completed. The response generated from the /Auth endpoint will include "RedirectData" and a "SpiToken" that you will need for subsequent requests.

> 📘
>
> ### **Note !**
>
> **It's important to note that the "SpiToken" lives for 5 minutes**

## **Presenting the cardholder with the RedirectData**

![](https://files.readme.io/c1ccd36-image.png)

As step 1.4 (image above) indicated, we must take the RedirectData from the response and present it to the cardholder browser (CHB) inside an iFrame.

We can achieve this by rendering in the cardholder browser the following HTML code.

HTML

```
<iframe srcdoc="{RedirectData}" frameborder="0" width="100%" height="500"></iframe>
```

Once the RedirectData has been bound to the Iframe, the process will continue in the context of the Iframe.

- HPP form will appear in the iFrame, and the Card Holder will enter credit card details and billing information

![](https://files.readme.io/5892296-image.png)

![](https://files.readme.io/a9a45f7-image.png)

- Once the Card Holder enters the required information and confirms payment, the iFrame context will post details to Powertranz.
- FraudCheck request is submitted form card holder browser (iFrame) to Fraud Service and response is redirects to Powertranz
- Powertranz starts 3DS authentication process and the cardholder may be challenged (Challenge flow ) to add further authentication; at this point, a form will appear in the iFrame, and the cardholder will enter additional information.

For instance, let's consider the following challenge generated by the test card. In order to proceed, you will need to input the password "3ds2" (without the quotation marks).

![](https://files.readme.io/8391cfb-image.png)

When cardholder completes the challenge, Powertranz processes it and the response will be sent to the "MerchantResponseUrl" posted originally in spi/Auth payload. the response looks like below

JSON

```
{
  "TransactionType": 1,
  "Approved": false,
  "TransactionIdentifier": "Your Transaction ID",
  "TotalAmount": 1.00,
  "CurrencyCode": "840",
  "CardBrand": "Visa",
  "IsoResponseCode": "3D0",
  "ResponseMessage": "3DS complete",
  "RiskManagement": {
    "ThreeDSecure": {
      "Eci": "05",
      "Cavv": "AJkBCQIGiIYplVGQaQaIAAAAAAA=",
      "Xid": "a52657a5-687a-4b69-acc8-116fcaf8b256",
      "AuthenticationStatus": "Y",
      "ProtocolVersion": "2.1.0",
      "FingerprintIndicator": "U",
      "DsTransId": "7532f512-eb91-4970-a76b-193af48f8765",
      "ResponseCode": "3D0",
      "CardholderInfo": "Additional authentication is needed for this transaction,
      'please contact(Issuer Name) at xxx - xxx - xxxx.'"
    },
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
        "MerchantId": "240000",
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
        "IPAddress": "192.172.249.242",
        "IPAddressLatitude": "32.3201",
        "IPAddressLongitude": "-64.7376",
        "IPAddressCountry": "BM",
        "IPAddressRegion": "Hamilton",
        "IPAddressCity": "Hamilton",
        "IPAddressOrganization": "Comm Ltd",
        "DateDeviceFirstSeen": "2023-08-22",
        "UserAgentString": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)
          'Chrome/112.0.0.0 Safari/537.36'",
        "DeviceScreenResolution": "1080x1920",
        "OS": "Windows 10"
      },
      "FcTransId": "K8Y00CCN4WVM"
    }
  },
  "PanToken": "87a2c47ikbw9qqv4pda7syb5rgl1qaxnlec2s1w2ag6rmx02r",
  "ExternalIdentifier": "Your external identifier from the payload should be reflected here",
  "OrderIdentifier": "Your order identifier from the payload should be reflected here",
  "SpiToken": "1b24q6x9u42by90vxsohpz6r93t51esecyyakgslzbc388r1nzl-iseenw5eb"
}
```

> 📘
>
> ### **Note !**
>
> If no additional cardholder input is required (Frictionless flow), the iFrame context will post the Authentication and FraudCheck results directly to the Merchant Response URL.

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

If we take a look at the response , it contains an IsoResponseCode of "3D0" ( 3DS authentication completed) , an AuthenticationStatus of "Y" (Authenticated) , ECI value of "05" , Cavv value and also FcResponseCode as "A" (Approved) We can interpret this response as successful Fraud check and 3DS authentication result . Check the Response and Status Code section for other successful authentication values.

To complete the payment portion of the transaction, merchants should call "/payment" and pass the SpiToken in an HTTP Post request. Powertranz will send the transaction to the relevant payment network and reply to the merchant.

> 📘
>
> ### **The payment completion request does not require PowerTranz-PowerTranzId and PowerTranz-PowerTranzPassword values in the header**

> 📘
>
> ### **The payment completion request will be declined by default if the 3DS authentication is unsuccessful. Consequently, there is no need to initiate the payment completion if the 3DS authentication is unsuccessful.**

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
    "PanToken": "1glhritqittv5cslkx5awmljha8cjrntjjnawagki4czpg9qap",
    "OrderIdentifier": "Your order identifier from the payload should be reflected here"
}
```

Above response has approved flag as true and the IsoResponseCode is "00" . We can interpret this response as an approved authorization.
