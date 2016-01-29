# Notification Service Flows

## New Client Flow

1. `Client` connects to notification service
2. `Notification Service` requests identification
3. `Client` generates an `authentication key pair` (specific to notification service)
4. `Client` sends id and hash of `authentication public key`, signed, to the `Notification Service`
5. `Notification Service` attempts to find saved authentication public key for id and public authentication key hash (and fails)
	- We treat public authentication key hashes from reconnections that don’t match what is stored exactly the same as a new registration.
6. `Notification Service` generates `notification key pair`, store notification private key for lookup by client id and hash of public authentication key.
7. `Notification Service` sends the `notification public key` to `Client`
8. `Client` stores `notification public key` for the notification service
9. `Client` uses `notification public key` to encrypt `username` and hash of `username`, `notification public key` hash, and `password` to sign in. Also encrypt `authentication public key` using `notification public key` and send to `Notification service`. Sign this message with the `authentication private key`
10. `Notification Service` decrypts authentication tokens. Verify signature. Use authentication hash to look up user (or employ other authentication services to verify user). If user is found (and authenticated), save `authentication public key` for lookup by `client id` and hash of `public authentication key`.
	+ If other notification clients already exist for the user and server is so configured, send a notification to the other clients and get confirmation from at least one before saving authentication key.
	+ Alternatively, use 2FA server after lookup of user. 
	
	_It is preferred that the notification server never have access to the actual password, but if needed for 2FA, it or another authentication token can be sent instead of the username/password hash._

**The `Notification Source` plays no role in new client connecting to notification service**


## Returning Client Flow

1. `Client` connects to `Notification Service`
2. `Notification Service` requests identification
3. `Client` sends id and hash of `public authentication key` for `Notification Service` (which must already exist)
4. `Notification Service` attempts to find saved authentication public key for `client id` and `public authentication key` hash (and succeed)
	+ We treat public authentication key hashes from reconnections that don’t match what is stored exactly the same as a new registration.
5. `Notification Service` sends the stored `notification public key` to `Client` 
6. `Client` verifies that the `notification public key` matches, if not authentication fails.
7. `Client` uses the `notification public key` to encrypt `username` and hash of `username`, `notification public key` hash, and `password` to sign in. Pad with fake/real (unnecessary) `authentication public key`. Sign this message with the `authentication private key`.
8. `Notification Service` decrypts authentication tokens. Verify signature. Use hash (or authentication service) to look up user. Ignore public key passed back.


**As with the New Client Flow, the `Notification Source` plays no role in the `Client` reconnecting with the `Notification service`.**


## Client Registration with Notification Source

### Goals

1. `Client` does not send (broadly used) ID so IDs can be easily revoked
2. `Notification Source` is verified and notifications are encrypted while in transit
3. `Notification Service` knows who to send the notification to
4. Limit complexity for `Notification Source`s

### Tools

+ `Client` can sign things with it’s private key **during registration** only
+ `Client` can encrypt things with the `notification service` provided `notification public key` **during registration** only
+ `Client` *can* send an identifier for the `Notification Source` to the `Notification Service` during registration, since we expect the `Notification Service` to always be online
+ The `Notification Source` *could* do it’s own key exchange with the `Notification Server` during registration (might avoid to limit complexity for notification sources)
+ Registration *should* probably include sending a targeted test notification to verify end to end communication

### The Flow

1. `Client` requests and receives a (potentially temporary) public key from the `Notification Source`
2. `Client` generates a `Unique Notification Source ID` 
3. `Client` generates an `authentication token` consisting of the `Unique Notification Source ID`, `Client ID`, a `token generation timestamp`, and a pseudorandom `passcode` which may be used as the basis for generating `Notification Symmetric Encryption Key`s.
4. `Client` encrypts with the (potentially temporary) public key and sends the `Notification Source`:
    1. the `Unique Notification Source ID`
    2. the `authentication token`
    3. the pseudorandom `passcode`
    4. and a `Notification Service` endpoint (possibly referencing DNS)
5. `Client` registers the `Unique Notification Source ID` with the `Notification Service` using its `Client ID` and encrypting with its `Notification Service` specfic `Notification Public Key`. It receives back an acknowledgement that registration is pending and a random integer `Start Count`.
6. `Client` sends the `Notification Source` the random `Start Count` to indicate that registration is pending.
7. `Notification Source` confirms registration with the `Notification Service` endpoint by sending a notification containing a registration token/url (using option 2 below and the provided `Start Count`) It receives back one or more of:
    1. a public key for sending future notifications from the `Notification Source` to the `Notification Service`
    2. a secondary `Notification Source Passcode` to be used in future `Notification Symmetric Encryption Key` generation
    3. a future `Start Count` and/or `Increment Interval` for calculating the `Notifications Sent Count` to be used in future `Notification Symmetric Encryption Key` generation
    4. AND/OR an acknowledgement that the notification was received (but not necessarily sent.)
8. The `Notification Service` sends the registration notification to the `Client` (and, potentially, all of the user's other notification clients.)
9. The `Client` or another of the user's clients completes the registration by acknowledging the registration token with the `Notification Source` and then the `Notification Server`.

## Sending a notification

1. A `Notification Source` sends its `Unique Notification Source ID` and `Authentication Token` to the `Notification Service`.
2. The `Notification Service` uses the provided `Unique Notification Source ID` to lookup the `Client ID` and `Notification Private Key` associated with the `Client` and uses it to decrypt the `Authentication Token`.
3. The `Authentication Token` contains the `Unique Notification Source ID`, `Client ID`, generation `timestamp`, and a random `passcode` to used to generate a `Notification Symmetric Encryption Key` with each notification. The `passcode` is generated by the `Client` during registration. If the `Authentication Token` decrypts (when passed to the `Notification Service`) to contain the correct `Unique Notification Source ID` and `Client ID` (which the `Notification Source` does not know), the `Notification Server` knows that this `Notification Source` is authorized to send a notification to the `Client`s user.
4. The `Notification Source` encrypts the notification body:
	+ (option 1 - ignores passcode initializer. *Requires a public key provided by the `Notification Service`) The notification source encrypts the notification body with its `Notification Source Public Key`, provided by the `Notification Service`, allowing the `Notification Service` to decrypt and forward the notification body. 	_This allows the `Notification Service` to examine the notification content and publish it to all authorized clients for the user, therefore the `Notification Source` could also hash and sign the message body using a key pair it has generated and provided the public key to the `Client` during registration - but if the public key is kept on the original `Client` only, only the originally registering `Client` would have the ability actually make use of this, so it’s questionable whether we should do this; the `Notification Service` is already a trusted service at this point._
	+ (option 2 or 3) The `Notification Source` is provided a random `passcode` by the `Client` during registration. When it sends a notification, it generates a `Unique Notification ID` and sha1 hashes it with the `passcode` provided by the `Client`, a `Notification Source Passcode` if provided by the `Notifcation Service` during registration, the current `Notification Count` if a `Start Count` and/or `Increment Interval` was provided by the `Notifcation Service` during registration, and current `timestamp` in milliseconds since Unix epoch to generate an encryption key. The `Notification Source` then encrypts the body of the message with the resulting hash. The notification source then sends a json payload to the notification server that looks like this:

~~~javascript
	{
	 "source": "{source_id}",
	 "token": "{authentication_token}",
	 "notification": "{notification_id}",
	 "time": {timestamp_milliseconds}
	 "body": "{encrypted_body}"
	}
~~~

The `Notification Service` has access to the random `passcode` by decrypting the `Authentication Token` using it’s private notification key for the client. This allows it to regenerate the `Notification Symmetric Encryption Key` using the provided `Unique Notification ID`, `timestamp`, a `Notification Source Passcode` (if it exists), and it’s own count of notifications received from this `Unique Notification Source ID` (if it is tracking this.) It then decrypts the notification body and, if intelligible, forwards it to all notification `Client ID`s associated with the user registered with this `Client ID`.


## Notes and Ideas

+ Allow registering one notification service as a notification source for another, thus proxying a notification from one source to another.

+ The hope is to have more secure flow by having 3 legs to registering and actually sending messages. It is more difficult to set up a man in the middle attack that intercepts both the communications between the client and the notification server and notification source AND intercepts the communications directly between the notification source and the notification server.



