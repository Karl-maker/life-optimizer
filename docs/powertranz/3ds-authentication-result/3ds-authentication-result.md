#### **3DS Authentication Result**

After the completion of the 3DS authentication process, Powertranz returns the authentication response to the merchant application.

The authentication response contains a nested object **"RiskManagement.ThreeDSecure"** that holds critical data related to the outcome of the 3DS authentication.

> 🚧
>
> ### ***You should be able to interpret important field values and decide whether to proceed with payment completion.**

Example response :

JSON

```
{
  "TransactionType": 1,
  "Approved": false,
  "TransactionIdentifier": "79d814e6-850f-46b8-96ac-143331b012ab",
  "TotalAmount": 2.0,
  "CurrencyCode": "978",
  "CardBrand": "Visa",
  "IsoResponseCode": "3D0",
  "ResponseMessage": "3DS complete",
  "RiskManagement": {
    "ThreeDSecure": {
      "Eci": "05",
      "Cavv": "AJkBCQIGiIYplVGQaQaIAAAAAAA=",
      "Xid": "fe22ebcf-1b4f-496d-a48e-452a7a0da62f",
      "AuthenticationStatus": "Y",
      "Token": "30z9cc0bp5lv7i4g9vrghabt9y8pg2j2r6rh9ntr4m7ruzd1ee-iseenw5eb",
      "ProtocolVersion": "2.1.0",
      "FingerprintIndicator": "Y",
      "DsTransId": "01f1d622-5f32-41c0-a162-adb9f4e20c9c",
      "ResponseCode": "3D0"
    }
  },
  "ExternalIdentifier": "Your externalIdentifier here",
  "OrderIdentifier": "Your OrderIdentifier here",
  "SpiToken": "30z9cc0bp5lv7i4g9vrghabt9y8pg2j2r6rh9ntr4m7ruzd1ee-iseenw5eb"
}
```
