#### **Liability Shift for Financial Transactions**

Liability shift holds significant importance within the framework of 3D Secure 2 (3DS2) authentication, impacting how financial responsibility is assigned for certain types of fraudulent online transactions. In essence, liability shift determines whether the merchant or the card issuer assumes the financial burden in cases of fraud. Please

When transactions are effectively authenticated, you stand to benefit from the liability shift for certain MCC codes. It means you're less exposed to the financial repercussions of certain fraudulent chargebacks. This adds a layer of security to your business, reducing potential financial strain arising from unauthorized transactions

Below tables show the conditions when liability of a fraudulent transaction shifts to issuer.

# **MasterCard**

| **ECI**                    | **CAVV**    | **3DS Status** | **Description**                                                                | **Liability Shift**           |
| -------------------------- | ----------- | -------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| 02                         | Present     | Y              | Authentication successful by issuer                                            | Yes (for certain MCC codes) * |
| 01                         | Present     | A              | Network stepped in for the authentication because issuer was not participating | Yes(for certain MCC codes)*   |
| 00                         | Not Present | N              | Authentication failed                                                          |
| Not authenticated          |
| Transaction denied         | No          |
| 00                         | Not Present | U              | Authentication could not be performed                                          |
| Technical or other Problem | No          |
| 00                         | Not Present | R              | Authentication rejected                                                        | No                            |

# **VISA & AMEX**

| **ECI**                    | **CAVV**    | **3DS Status** | **Description**                                                                | **Liability Shift**          |
| -------------------------- | ----------- | -------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| 05                         | Present     | Y              | Authentication successful by issuer                                            | Yes (for certain MCC codes)* |
| 06                         | Present     | A              | Network stepped in for the authentication because issuer was not participating | Yes (for certain MCC codes)* |
| 07                         | Not Present | N              | Authentication failed                                                          |
| Not authenticated          |
| Transaction denied         | No          |
| 07                         | Not Present | U              | Authentication could not be performed                                          |
| Technical or other Problem | No          |
| 07                         | Not Present | R              | Authentication rejected                                                        | No                           |

> 🚧
>
> ### **Good to know !**
>
> - Protection from 3DS2 Liability shift does not apply all scenario conditions. For VISA, if a merchant is in "Fraud Monitoring Program" they can still be found liable for disputes.
>
> Please contact your acquiring bank for any questions related to chargebacks and liability shift.
