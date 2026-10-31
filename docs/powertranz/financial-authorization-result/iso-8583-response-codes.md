#### **ISO8583 Response Codes**

The ISO 8583 response code is returned in the IsoResponseCode response parameter following payment completion or an FPI authorization or sale. These codes represent the outcome of the financial transaction and are assigned in most cases by the issuing bank but can also be returned by the acquirer or the card network (e.g., Visa, Mastercard). Powertranz will not decline a financial authorization.

The specific response codes can vary depending on the implementation and the financial institution involved, but some common examples of ISO 8583 response codes include:

- 00: Approved or Completed Successfully
- 05: Do Not Honor
- 12: Invalid Transaction
- 51: Insufficient Funds
- 54: Expired Card
- 57: Transaction Not Permitted to Cardholder
- 91: Issuer Unavailable

Each code has a specific meaning and guides the next steps to be taken by the involved parties. For example, an "Approved" code (00) indicates that the transaction was successful, while a "Refer to Card Issuer" code (01) suggests that the merchant should contact the card issuer to determine why the decline was returned. The below table shows possible response codes and their description returned for **payment** transaction.

# **Financial Transaction ISO Response Codes**

| **Response Code** | **Description**                                       |
| ----------------- | ----------------------------------------------------- |
| 00                | Approved                                              |
| 01                | Refer to issuer                                       |
| 02                | Refer to issuer (special)                             |
| 03                | Invalid merchant                                      |
| 04                | Pick-up card                                          |
| 05                | Do not honor                                          |
| 06                | Error                                                 |
| 07                | Pick-up card (special)                                |
| 08                | Honor with identification                             |
| 09                | Request in progress                                   |
| 10                | Approved for partial amount                           |
| 11                | VIP Approval                                          |
| 12                | Invalid transaction                                   |
| 13                | Invalid amount                                        |
| 14                | Card number does not exist                            |
| 15                | No such issuer                                        |
| 16                | Approved, update track 3                              |
| 17                | Customer cancellation                                 |
| 18                | Customer dispute                                      |
| 19                | Re-enter transaction                                  |
| 20                | Invalid response                                      |
| 21                | No action taken (no match)                            |
| 22                | Suspected malfunction                                 |
| 23                | Unacceptable transaction fee                          |
| 24                | File update not supported by receiver                 |
| 25                | Unable to locate record                               |
| 26                | Duplicate file update record                          |
| 27                | File update field edit error                          |
| 28                | File temporarily unavailable                          |
| 29                | File update not successful                            |
| 30                | Format error                                          |
| 31                | Issuer sign-off                                       |
| 32                | Completed partially                                   |
| 33                | Expired card                                          |
| 34                | Suspected fraud                                       |
| 35                | Card acceptor contact acquirer                        |
| 36                | Restricted card                                       |
| 37                | Card acceptor call acquirer                           |
| 38                | Allowable PIN tries exceeded                          |
| 39                | No credit account                                     |
| 40                | Function not supported                                |
| 41                | Pick-up card (lost card)                              |
| 42                | No universal account                                  |
| 43                | Pick-up card (stolen card)                            |
| 44                | No investment account                                 |
| 51                | Not sufficient funds                                  |
| 52                | No checking account                                   |
| 53                | No savings account                                    |
| 54                | Expired card                                          |
| 55                | Incorrect PIN                                         |
| 56                | No card record                                        |
| 57                | Transaction not permitted to card                     |
| 58                | Transaction not permitted to card                     |
| 59                | Suspected fraud                                       |
| 60                | Card acceptor contact acquirer                        |
| 61                | Exceeds withdrawal limit                              |
| 62                | Restricted card                                       |
| 63                | Security violation                                    |
| 64                | Original amount incorrect                             |
| 65                | Activity count exceeded                               |
| 66                | Card acceptor call acquirer                           |
| 67                | Card pick up at ATM                                   |
| 68                | Response received too late                            |
| 75                | Too many wrong PIN tries                              |
| 76                | Previous message not found                            |
| 77                | Data does not match original message                  |
| 80                | Invalid date                                          |
| 81                | Cryptographic error in PIN                            |
| 82                | Incorrect CVV (Visa/Amex), Policy (MC)                |
| 83                | Unable to verify PIN (Visa/Amex), Fraud/Security (MC) |
| 84                | Invalid authorization life cycle                      |
| 85                | No reason to decline                                  |
| 86                | PIN validation not possible                           |
| 88                | Cryptographic failure                                 |
| 89                | Authentication failure                                |
| 90                | Cutoff is in process                                  |
| 91                | Issuer or switch inoperative                          |
| 92                | No routing path                                       |
| 93                | Violation of law                                      |
| 94                | Duplicate transmission                                |
| 95                | Reconcile error                                       |
| 96                | System malfunction                                    |
| 97                | Format Error                                          |
| 98                | Host Unreachable                                      |
| 99                | Errored Transaction                                   |
| N0                | Force STIP                                            |
| N3                | Cash Service Not Available                            |
| N4                | Cash request exceeds issuer limit                     |
| N7                | Decline for CVV2 failure                              |
| P2                | Invalid biller information                            |
| P5                | PIN Change Unblock Declined                           |
| P6                | Unsafe PIN                                            |
| XA                | Forward to issuer                                     |
| XD                | Forward to issuer                                     |

**Updated over 1 year ago**
