#### **Transaction Risk Analysis**Combining "ECI" and "3DS Authentication Status" to estimate risk level

Merchants should conduct risk analysis for each transaction and make an informed decision on whether to proceed with payment processing.

Risk analysis enables merchants to take appropriate actions during payment processing to decline potentially fraudulent transactions and avoid liability for approved transactions with liability shift rules. This helps merchants enhance security, protect against losses, and build trust with their customers in the online payment ecosystem.

Here are some general guidelines on how to analyze risk level based on ECI and 3DS Authentication status codes:

**Authenticated Transactions**:

- VISA: ECI=05 (Secure Electronic Commerce Transaction) and 3DS Authentication Status=Y (Authentication Successful).
- Mastercard: ECI=02 (Authenticated Transaction) and 3DS Authentication Status=Y (Authentication Successful).
- Mastercard: ECI=N2 (Authenticated Transaction - NPA transaction) and 3DS Authentication Status=Y (Authentication Successful).
- American Express: ECI=05 (Cardholder Authentication Successful) and 3DS Authentication Status=Y (Authentication Successful).

CAVV value is expected to be present and valid, confirming successful authentication with the exception of MasterCard's N2 response as this is for non-payment transactions.

**Attempted Authenticated Transactions**:

- VISA: ECI=06 (Attempted Secure Electronic Commerce Transaction) and 3DS Authentication Status=A (Attempted Authentication Performed).
- Mastercard: ECI=01 (Attempted Authentication) and 3DS Authentication Status=A (Attempted Authentication Performed).
- American Express: ECI=06 (Attempted Secure Electronic Commerce Transaction) and 3DS Authentication Status=A (Attempted Authentication Performed).

CAVV value is expected to be present and valid, confirming attempted authentication.

> 📘
>
> ### **Note**
>
> Authenticated and attempted authenticated transactions are both protected by 3DS.

**Non Authenticated Transactions**:

- VISA: ECI=07 (Non-Secure Electronic Commerce Transaction) and 3DS Authentication Status=U (Authentication Unavailable) or 3DS Authentication Status=N (Authentication Failed).
- Mastercard: ECI=00 (Non-Authenticated Transaction) and 3DS Authentication Status=U (Authentication Unavailable) or 3DS Authentication Status=N (Authentication Failed).
- American Express: ECI=07 (Non-Secure Electronic Commerce Transaction) and 3DS Authentication Status=U (Authentication Unavailable) or 3DS Authentication Status=N (Authentication Failed).

CAVV value is not expected to be present or valid as these transactions did not go through 3D Secure authentication.

It's important to note that the specific actions and decisions based on ECI and 3DS status codes may vary depending on your business requirements, risk tolerance, and fraud prevention strategies. As such, it's recommended to implement the appropriate logic that aligns with your specific business needs and security protocols. Additionally, always stay up to date with the latest guidelines and best practices in the industry to ensure the most effective and secure decision-making process.
