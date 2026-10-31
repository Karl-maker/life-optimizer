#### **FcResponseCode**

FcResponseCode represents the response code returned by Kount's system after analyzing a transaction for potential fraud. The "FcResponseCode" provides valuable insights into the risk level associated with the specific transaction.

The FcResponseCode provides The Kount result of the transaction. These responses can be used in rule creation within the Kount platform to return a specified result when different risk scenarios are defined and met.

| **Kount Result** | **Meaning** |
| ---------------- | ----------- |
| A                | Approved    |
| D                | Declined    |
| E                | Escalate    |
| R                | Review      |

> 📘
>
> ### **Good to know !**
>
> A 3DS authentication will be performed if the **FCResponseCode** is not a Decline (**D**) and the ThreeDSecure flag is set to true in the initial request.
