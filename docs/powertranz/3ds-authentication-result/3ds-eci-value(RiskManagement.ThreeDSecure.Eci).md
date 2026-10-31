#### **3DS ECI value**(RiskManagement.ThreeDSecure.Eci)

The Electronic Commerce Indicator (ECI) is a value returned by the card associations indicating the outcome of authentication attempted on transactions enforced by 3DS.It's important to note that the specific ECI values and their meanings may vary depending on the card network (Visa, Mastercard, etc.).

### **Possible values returned by Visa and American Express are:**

- ECI 05: 3DS authentication was successful.
- ECI 06: 3DS authentication was attempted.
- ECI 07: 3DS authentication failed or not available. Considered non-3DS.

### **Possible value returned by MasterCard:**

- ECI 02: 3DS authentication is successful.
- ECI 01: 3DS authentication was attempted.
- ECI 00: 3DS authentication failed or not available. Considered non-3DS.
- ECI N2: 3DS authentication was successful for NPA transactions.
- ECI N0: 3DS authentication failed for NPA transactions.

> 📘
>
> ### **Good to Know !**
>
> An ECI value will not always be returned depending on the authentication result.
