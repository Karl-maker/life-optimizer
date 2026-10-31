#### **CVV2 Reponse codes**

While 3DS2 provides strong cardholder authentication and reduces the need for additional verification steps, the CVV2 response still serves as an added layer of security, especially for scenarios where 3DS2 is not applicable or not supported. Additionally, some transactions may not require 3DS2 authentication, and in those cases, CCV2 response can help mitigate potential fraud. Note that some acquirers mandate that CVV2 be included in all transaction requests.

Powertranz extracts the CVV2 verification result from the response message received from the issuing bank and returns it to merchants.

| **Code** | **Definition**                                      |
| -------- | --------------------------------------------------- |
| M        | Match                                               |
| N        | No match.                                           |
| P        | Not Processed                                       |
| S        | Should be on card but was not provided. (Visa only) |
| U        | Issuer not participating or certified.              |
