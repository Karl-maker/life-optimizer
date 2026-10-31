#### **3DS Authentication Status**(RiskManagement.ThreeDSecure.AuthenticationStatus)

The table below shows possible authentication status values and their meaning. Payment completion will be permitted only if the authentication status is Y or A (authenticated) or U (attempted but unavailable - considered non-3DS). Payment completion will **not** be permitted if the authentication status is N or R (not authenticated). Authentication Status determines the result of the 3DS2 authentication along with the ECI Indicator and IsoResponseCode.

| **Value** | **Description**                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Y**     | Authentication/account verification successful                                                                          |
| **A**     | Attempt processing performed                                                                                            |
| **N**     | Not authenticated/account not verified; transaction denied                                                              |
| **U**     | Authentication/account verification could not be performed due to a technical or other problem.                         |
| **R**     | Authentication/account verification rejected. The issuer is rejecting and requests that authorization not be attempted. |
| **C**     | Challenge required to authenticate the cardholder                                                                       |

> 📘
>
> ### **The response from a challenge flow will only return a result of Y or N.**

> 📘
>
> ### **Note !**
>
> In the case of a failed 3DS authentication (status N or R), you may also get additional information from **StatusReason** field and/or the **CardholderInfo field**. It is recommended to display the CardholderInfo response to the cardholder in the event of a failed authentication as it may provide additional detaiil or instructions on how to contact their issuing bank.

Status Reason Codes

| **Value**                                 | **Description**                             |
| ----------------------------------------- | ------------------------------------------- |
| 01                                        | Card authentication failed                  |
| 02                                        | Unknown Device                              |
| 03                                        | Unsupported Device                          |
| 04                                        | Exceeds authentication frequency limit      |
| 05                                        | Expired card                                |
| 06                                        | Invalid card number                         |
| 07                                        | Invalid transaction                         |
| 08                                        | No Card record                              |
| 09                                        | Security failure                            |
| 10                                        | Stolen card                                 |
| 11                                        | Suspected fraud                             |
| 12                                        | Transaction not permitted to cardholder     |
| 13                                        | Cardholder not enrolled in service          |
| 14                                        | Transaction timed out at the ACS            |
| 15                                        | Low confidence                              |
| 16                                        | Medium confidence                           |
| 17                                        | High confidence                             |
| 18                                        | Very high confidence                        |
| 19                                        | Exceeds ACS maximum challenges              |
| 20                                        | Non-Payment transaction not supported       |
| 21                                        | 3RI transaction not supported               |
| 22                                        | ACS technical issue                         |
| 26                                        | Authentication attempted but not            |
| performed by the cardholder               |
| 80                                        | Visa/AX: Error connecting to ACS            |
| MC: reserved for data only                |
| 81                                        | VI/AX: ACS timed out                        |
| MC: Challenge exemption accepted          |
| 82                                        | VI/AX: Invalid response from ACS            |
| MC: Challenge mandate requested nut could |
| not be performed                          |
| 83                                        | VI/AX: System error response from ACS       |
| 84                                        | VI/AX: Internal error while generating CAVV |
| 85                                        | VI/AX: MID not eligible for requested       |
| program                                   |
| 86                                        | VI/AX: Protocol version not supported by    |
| ACS                                       |
| 87                                        | VI/AX: Transaction is excluded from         |
| attempts processing                       |
| 88                                        | VI/AX: Requested program not supported by   |
| the ACS                                   |
| 89                                        | CAVV is included in response                |
| 90                                        | VI/AX: Issuer SCA required                  |
