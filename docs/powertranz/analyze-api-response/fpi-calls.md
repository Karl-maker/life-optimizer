#### **FPI calls**

If you opt for the FPI integration method during your account setup, please check below tables that outline expected response codes for successful API calls.

# **FPI 3DS +Challenge flow**

| **Step**                                              | **Expected/Recommended Result**                                                                                                                            | **Note**                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1- Call /api/Auth,Sale or RiskMgmt                    | IsoResponseCode=`3D5` or `3D1`                                                                                                                             | If you receive a different IsoResponseCode check the Response and Status Codes section for details. |
| 2- Call /api/3DS2/Authenticate                        | IsoResponseCode = `3D6`                                                                                                                                    | Challenge the cardholder                                                                            |
| 3- Interpret response received on MerchantResponseURL | IsoResponseCode = `3D0`                                                                                                                                    |                                                                                                     |
| 4- Analyze 3DS authentication Response                | RiskManagement.ThreeDSecure.AuthenticationStatus RiskManagement.ThreeDSecure.Cavv RiskManagement.ThreeDSecure.ECI RiskManagement.ThreeDSecure.ResponseCode | Interpret the values returned and decide if you want to proceed with payment completion             |
| 5- Call /api/Payment                                  | IsoResponseCode=`00` , Approved=`true`                                                                                                                     |                                                                                                     |

# **FPI 3DS + Challenge flow + Device FingerPrint**

| **Step**                                              | **Expected/Recommended Result**                                                                                                                            | **Note**                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1- Call /api/Auth,Sale or RiskMgmt                    | IsoResponseCode=`3D5` or `3D1`                                                                                                                             | If you receive a different IsoResponseCode check the Response and Status Codes section for details.                      |
| 2- Call /api/3DS2/Authenticate                        | IsoResponseCode = `3D6`                                                                                                                                    | Challenge the cardholder                                                                                                 |
| 3- Interpret response received on MerchantResponseURL | IsoResponseCode = `3D0`                                                                                                                                    |                                                                                                                          |
| 4- Analyze 3DS authentication Response                | RiskManagement.ThreeDSecure.AuthenticationStatus RiskManagement.ThreeDSecure.Cavv RiskManagement.ThreeDSecure.ECI RiskManagement.ThreeDSecure.ResponseCode | Interpret the values returned and decide if you want to proceed with payment completion                                  |
| 5- Call /api/Payment                                  | IsoResponseCode=`00` , Approved=`true`                                                                                                                     | If you receive Approved `false` and a different IsoResponseCode check the Response and Status Codes section for details. |

# **FPI 3DS + Frictionless + Device FingerPrint**

| **Step**                               | **Expected/Recommended Result**                                                                                                                            | **Note**                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1- Call /api/Auth,Sale or RiskMgmt     | IsoResponseCode=`3D5` or `3D1`                                                                                                                             | If you receive a different IsoResponseCode check the Response and Status Codes section for details.                      |
| 2- Call /api/3DS2/Authenticate         | IsoResponseCode = `3D0`                                                                                                                                    |                                                                                                                          |
| 3- Analyze 3DS authentication Response | RiskManagement.ThreeDSecure.AuthenticationStatus RiskManagement.ThreeDSecure.Cavv RiskManagement.ThreeDSecure.ECI RiskManagement.ThreeDSecure.ResponseCode | Interpret the values returned and decide if you want to proceed with payment completion                                  |
| 4- Call /api/Payment                   | IsoResponseCode=`00` , Approved=`true`                                                                                                                     | If you receive Approved `false` and a different IsoResponseCode check the Response and Status Codes section for details. |

# **FPI 3DS + Frictionless**

| **Step**                               | **Expected/Recommended Result**                                                                                                                            | **Note**                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1- Call /api/Auth,Sale or RiskMgmt     | IsoResponseCode=`3D0` or `3D1`                                                                                                                             | If you receive a different IsoResponseCode check the Response and Status Codes section for details.                      |
| 2- Analyze 3DS authentication Response | RiskManagement.ThreeDSecure.AuthenticationStatus RiskManagement.ThreeDSecure.Cavv RiskManagement.ThreeDSecure.ECI RiskManagement.ThreeDSecure.ResponseCode | Interpret the values returned and decide if you want to proceed with payment completion                                  |
| 3- Call /api/Payment                   | IsoResponseCode=`00` , Approved=`true`                                                                                                                     | If you receive Approved `false` and a different IsoResponseCode check the Response and Status Codes section for details. |

# **Subsequent Financial Transaction Management Calls**

| **Step**                                         | **Expected/Recommended Result**        | **Note**                                                                                                                 |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 3- Call /api/Capture or /api/Refund or /api/Void | IsoResponseCode=`00` , Approved=`true` | If you receive Approved `false` and a different IsoResponseCode check the Response and Status Codes section for details. |
