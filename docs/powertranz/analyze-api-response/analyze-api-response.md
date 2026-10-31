Analyze API response
In this section, we aim to create a general guideline about how to determine if a 3DS authentication was successful and if you can proceed with payment completion. If you do not use FraudCheck service, this determination is reliant on three key factors: the "3DS Authentication Status," the "ECI value," and the "IsoResponseCode."

Essentially, this process can be broken down into two steps. First, you check the outcome of the 3DS authentication and subsequently, based on your risk tolerance, you make a decision about proceeding with the payment completion.

If you are utilizing the FraudCheck service it is important to examine and interpret the "ResponseCode," "FcResponseCode," "FcScore," and "FcDetails" elements. Based on your organization's risk appetite, these factors will aid in determining whether you are comfortable proceeding with the payment completion.

The final decision can be made by combing risk levels from 3DS and Fraudcheck responses, if you use both of them.

What to Do After an Unsuccessful/high risk Authentication ?
Below are some options that you could consider. The best solution will depend on your business and the type of goods and services sold.

1- Ask the customer to pay using a different payment method.

2- If the authentication service is unavailable or an error occurred during authentication or you have evaluated the transaction risk as High, you may consider requesting that the customer repeats the transaction. If the cardholder failed authentication, you are strongly advised not to proceed, particularly for high-value goods or services

🚧
Note !
If you want to performs additional security checks (without using 3DS2) to verify the customer's identity be aware that you will not benefit from liability shift and may be held liable for fraudulent transactions.
