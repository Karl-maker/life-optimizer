#### **SPI calls**

If you opt for the SPI integration method during your account setup, please check below tables that outline expected response codes for successful API calls.

# **SPI 3DS**

| **Step**                                                                                             | **Expected/Recommended Result**                                                         | **Note**                                                                                               |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1- Call /api/spi/Auth,Sale or RiskMgmt                                                               | IsoResponseCode=SP4                                                                     | If you receive a different IsoResponseCode check the Response and Status Codes section for details.    |
| 2- Interpret response received on MerchantResponseURL                                                | IsoResponseCode = 3D0 or 3D1                                                            | If IsoResponseCode=3D1 , 3DS2 is not supported for this card. Transaction with this card is considered |
| as non secure.                                                                                       |
| If you received a different IsoResponseCode check the Response and Status Codes section for details. |
| 3- Analyze 3DS authentication Response                                                               | RiskManagement.ThreeDSecure.AuthenticationStatus RiskManagement.ThreeDSecure.Cavv       |
| RiskManagement.ThreeDSecure.ECI RiskManagement.ThreeDSecure.ResponseCode                             | Interpret the values returned and decide if you want to proceed with payment completion |
| 4- Call /api/spi/Payment                                                                             | IsoResponseCode=00 , Approved=true                                                      | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes      |
| section for details.                                                                                 |

# **SPI 3DS Fraud Check**

| **Step**                                                                                                                                                                       | **Expected/Recommended Result**                                                                                                                                                                                        | **Note**                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1- Call /api/spi/Auth,Sale or RiskMgmt                                                                                                                                         | IsoResponseCode=SP4                                                                                                                                                                                                    | If you receive a different IsoResponseCode check the Response and Status Codes section for details                     |
| 2- Interpret response received on MerchantResponseURL                                                                                                                          | IsoResponseCode = 3D0 or 3D1                                                                                                                                                                                           |
| RiskManagement.FraudCheck.ResponseCode = FC0                                                                                                                                   |
| RiskManagement.FraudCheck.FcResponseCode <> D                                                                                                                                  | If IsoResponseCode=3D1, 3DS2 is not supported for this card. Transaction with this card is considered non-secure If you received a different IsoresponseCode check the Response and Status Codes section for details . |
| If FCResponseCode=D the 3DS process will not complete and payment Completion will not be allowed .If Kount process times/errors out, the 3DS authentication will be processed. |
| 3- Analyze 3DS Authentication Response and Fraud Check Results                                                                                                                 | RiskManagement.ThreeDSecure.AuthenticationStatus                                                                                                                                                                       |
| RiskManagement.ThreeDSecure.Cavv                                                                                                                                               |
| RiskManagement.ThreeDSecure.ECI                                                                                                                                                |
| RiskManagement.ThreeDSecure.ResponseCode                                                                                                                                       |
| RiskManagement.FraudCheck.ResponseCode                                                                                                                                         |
| RiskManagement.FraudCheck.FcResponseCode                                                                                                                                       |
| RiskManagement.FraudCheck.FcScore                                                                                                                                              | Interpret the values returned and decide if you want to proceed with payment completion                                                                                                                                |
| 4- Call /api/spi/Payment                                                                                                                                                       | IsoResponseCode=00 , Approved=true                                                                                                                                                                                     | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes section for details. |

# **SPI 3DS HPP**

| **Step**                                                                                             | **Expected/Recommended Result**                                                                                                                            | **Note**                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| IsoResponseCode=SP4                                                                                  | IsoResponseCode=SP4                                                                                                                                        | If you receive a different IsoResponseCode check the Response and Status Codes section for details                     |
| 2- Interpret response received on MerchantResponseURL                                                | IsoResponseCode=3D0 or 3D1                                                                                                                                 | If IsoResponseCode=3D1 , 3DS2 is not supported for this card. Transaction with this card is considered as non secure.  |
| If you received a different IsoResponseCode check the Response and Status Codes section for details. |
| 3- Analyze 3DS authentication Response                                                               | RiskManagement.ThreeDSecure.AuthenticationStatus RiskManagement.ThreeDSecure.Cavv RiskManagement.ThreeDSecure.ECI RiskManagement.ThreeDSecure.ResponseCode | Interpret the values returned and decide if you want to proceed with payment completion                                |
| 4- Call /api/spi/Payment                                                                             | IsoResponseCode=00 , Approved=true                                                                                                                         | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes section for details. |

# **SPI 3DS Fraud Check HPP**

| **Step**                                              | **Expected/Recommended Result** | **Note**                                                                                           |
| ----------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1- Call /api/spi/Auth,Sale or RiskMgmt                | IsoResponseCode=SP4             | If you receive a different IsoResponseCode check the Response and Status Codes section for details |
| 2- Interpret response received on MerchantResponseURL | IsoResponseCode = 3D0 or 3D1    |

RiskManagement.FraudCheck.ResponseCode = FC0

RiskManagement.FraudCheck.FcResponseCode <> D | If IsoResponseCode=3D1, 3DS2 is not supported for this card. Transaction with this card is considered non-secure If you received a different IsoresponseCode check the Response and Status Codes section for details .

If FCResponseCode=D the 3DS process will not complete and payment Completion will not be allowed. If Kount process times/errors out, the 3DS authentication will be processed. |
| 3- Analyze 3DS Authentication Response and Fraud Check Results | RiskManagement.ThreeDSecure.AuthenticationStatus

RiskManagement.ThreeDSecure.Cavv

RiskManagement.ThreeDSecure.ECI

RiskManagement.ThreeDSecure.ResponseCode

RiskManagement.FraudCheck.ResponseCode

RiskManagement.FraudCheck.FcResponseCode

RiskManagement.FraudCheck.FcScore | Interpret the values returned and decide if you want to proceed with payment completion |
| 4- Call /api/spi/Payment | IsoResponseCode=00 , Approved=true | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes section for details. |

# **SPI HPP**

| **Step**                                              | **Expected/Recommended Result**    | **Note**                                                                                                               |
| ----------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1- Call /api/spi/Auth,Sale or RiskMgmt                | IsoResponseCode=SP4                | If you receive a different IsoResponseCode check the Response and Status Codes section for details                     |
| 2- Interpret response received on MerchantResponseURL | IsoResponseCode = HP0              |                                                                                                                        |
| 3- Call /api/spi/Payment                              | IsoResponseCode=00 , Approved=true | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes section for details. |

# **SPI Fraud Check**

| **Step**                                              | **Expected/Recommended Result** | **Note**                                                                                           |
| ----------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1- Call to /api/spi/Auth,Sale or RiskMgmt             | IsoResponseCode=SP4             | If you receive a different IsoResponseCode check the Response and Status Codes section for details |
| 2- Interpret response received on MerchantResponseURL | IsoResponseCode = 3D0 or 3D1    |

RiskManagement.FraudCheck.ResponseCode = FC0

RiskManagement.FraudCheck.FcResponseCode <> D | If IsoResponseCode=3D1, 3DS2 is not supported for this card. Transaction with this card is considered non-secure. If you received a different IsoresponseCode check the Response and Status Codes section for details.

If FCResponseCode=D the 3DS process will not complete and payment Completion will not be allowed.

If Kount process times/errors out, the 3DS authentication will be processed. |
| 3- Analyze 3DS Authentication Response and Fraud Check Results | RiskManagement.ThreeDSecure.AuthenticationStatus

RiskManagement.ThreeDSecure.Cavv

RiskManagement.ThreeDSecure.ECI

RiskManagement.ThreeDSecure.ResponseCode

RiskManagement.FraudCheck.ResponseCode

RiskManagement.FraudCheck.FcResponseCode

RiskManagement.FraudCheck.FcScore | Interpret the values returned and decide if you want to proceed with payment completion |
| 4- Call to /api/spi/Payment | IsoResponseCode=00 , Approved=true | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes section for details. |

# **SPI Call Center Fraud Check**

| **Step**                                              | **Expected/Recommended Result**              | **Note**                                                                                           |
| ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1- Call /api/spi/Auth,Sale or RiskMgmt                | IsoResponseCode=FC0                          | If you receive a different IsoResponseCode check the Response and Status Codes section for details |
| 2- Interpret response received on MerchantResponseURL | RiskManagement.FraudCheck.ResponseCode = FC0 |

RiskManagement.FraudCheck.FcResponseCode <> D | If FCResponseCode=D the payment Completion will not be allowed . |
| 3- Asses transaction risk from Fraud Check Results (FcResponseCode, FcScore and FcDetails) | | |
| 3- Call /api/spi/Payment | IsoResponseCode=00 , Approved=true | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes section for details. |

# **Subsequent Financial Transaction Management Calls**

| **Step**                                         | **Expected/Recommended Result**    | **Note**                                                                                                               |
| ------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 3- Call /api/Capture or /api/Refund or /api/Void | IsoResponseCode=00 , Approved=true | If you receive Approved false and a different IsoResponseCode check the Response and Status Codes section for details. |
