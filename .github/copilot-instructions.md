Write commit messages using the Conventional Commits format:
type(scope): short description

Guidelines:
* Keep the title line short (ideally ≤ 50–72 characters).
* Use bullet points for readability.
* Focus on what changed, not the detailed implementation where possible.

Commit message example:

feat(auth): add registration, login, and email verification
* Implement BCrypt password hashing
* Add AccountController for authentication flows
* Create User and EmailVerification models
* Add SMTP email service for verification
* Add Razor views and custom CSS for authentication forms
* Update appsettings.json with email settings
* Change the default route to the registration page