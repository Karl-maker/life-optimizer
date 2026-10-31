#### **Fraud Check Result**

Powertranz’s Fraud Check service main component uses Kount™ (third-party solution & partner), a highly rated fraud scoring engine.

To use this service, a Kount account is required. Please contact Powertranz support.

Currently FraudCheck Service is supported on SPI integration types only and following combinations are available:

- A FraudCheck request can be a standalone request initiated to the spi/RiskMgmt endpoint or part of a financial transaction (initiated to the spi/auth or spi/sale endpoint).
- A FraudCheck request can be combined with a 3DS request by setting the ThreeDSecure flag to true and the FraudCheck flag to true in the same request either to the RiskMgmt endpoint or as part of a financial transaction (initiated to the spi/auth or spi/sale endpoint).
- A FraudCheck request can be used with an SPI HPP (hosted payment page) with or without 3DS authentication.

If FraudCheck service request is processed successfully, then the **FraudCheck** response object returned from Powertranz, will contain 4 important items :

1. **ResponseCode**
2. **FCResponseCode**
3. **FCScore**
4. **FcDetails**

The below sample FraudCheck response object showcases : ResponseCode, FcResponseCode, FcScore and FcDetails.

JSON

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
    "SpiToken": "SPI TOKEN will be here",
    "FraudCheck": {
        "FcProvider": "Kount",
        "ResponseCode": "FC0",
        "FcResponseCode": "A",
        "FcScore": "33",
        "FcTransId": "K9WC08BB7J9W",
        "FcDetails": {
            "ErrorCode": "0",
            "Version": "0695",
            "Mode": "Q",
            "TransactionId": "K9WC08BB7J9W",
            "MerchantId": "240000",
            "SessionId": "bccd03e020704e5fbda6f8d4abb29aeb",
            "OrderNumber": "INT-95e75078-7d58-40e8-8053-c3d4",
            "Auto": "R",
            "Score": "33",
            "Geox": "US",
            "Brand": "MSTR",
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
            "DeviceLayers": "2D5332442A..23EA1C3E4B.88292C253E.DB16B1D428",
            "MobileForwarder": "N",
            "VoiceDevice": "N",
            "LocalTime": "2022-09-16 10:48",
            "FingerPrint": "89E3933F0D384718B1FE447AD311E34B",
            "Flash": "N",
            "Language": "EN",
            "Country": "BM",
            "Cookies": "Y",
            "MobileDevice": "N",
            "Site": "DEFAULT",
            "IPAddress": "199.172.239.242",
            "IPAddressLatitude": "32.3201",
            "IPAddressLongitude": "-64.7376",
            "IPAddressCountry": "BM",
            "IPAddressRegion": "Hamilton",
            "IPAddressCity": "Hamilton",
            "IPAddressOrganization": "Internet Bermuda Limited",
            "DateDeviceFirstSeen": "2022-09-15",
            "UserAgentString": "Mozilla/5.0 (Windows NT6.2; Win64; x64) AppleWebKit/537.36 (KHTML, likeGecko) Chrome/99.0.4844.84 Safari/537.36",
            "DeviceScreenResolution": "1080x1920",
            "OS": "Windows 8"
        }
    }
}
```

> 🚧
>
> ### **Note !**
>
> Receiving time out/error messages in the ThreeDSecure and FraudCheck responses are possible.
>
> If the Kount request was combined with a 3DS request and the Kount process timed/errored out, the 3DS authentication will be processed, and an authentication response will be returned in the ThreeDSecure object.
