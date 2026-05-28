# Button and Tappable Element Audit

Scope: Login, Calendar, Friends, and Profile screens, including shared tappable components rendered on those screens.

## Login (`app/(auth)/login.tsx`)

| Element | Expected behavior | Actual before fix | Result |
| --- | --- | --- | --- |
| Email/password fields | Accept credentials. | Functional. | No change. |
| Sign In | Validate fields, sign in, navigate to tabs. | Functional. | No change. |
| Continue with Google | Start OAuth or show provider/config error. | Functional handler present. | No change. |
| Continue with Apple | Start OAuth on iOS or show provider/config error. | Functional handler present. | No change. |
| Sign Up link | Navigate to signup. | Functional. | No change. |

## Calendar (`app/(tabs)/index.tsx`)

| Element | Expected behavior | Actual before fix | Result |
| --- | --- | --- | --- |
| Calendar day | Toggle between in town and out of town, persist entry. | Handler present, but local/mock persistence could fail because mock Supabase did not support chained `insert(...).select().single()` and `update(...).eq(...).select().single()`. | Fixed mock Supabase mutation chaining. |
| Calendar month arrows | Move between months. | Provided by `react-native-calendars`; functional. | No change. |
| Day long press | Temporarily highlight a day on mobile. | Functional. | No change. |

## Friends (`app/(tabs)/friends.tsx`)

| Element | Expected behavior | Actual before fix | Result |
| --- | --- | --- | --- |
| Calendar/Friends/Search tabs | Switch content views. | Functional. | No change. |
| Friends calendar day | Provide feedback for tapped date. | Tappable calendar days had no `onDayPress`, so taps did nothing. | Added date selection and availability detail panel. |
| Search input submit | Search by name or email. | Could silently do nothing for empty input; mock `.or(...)` search acted like AND and missed valid users. | Added empty-query feedback/reset behavior and fixed mock OR filtering. |
| Search button | Search by name or email. | Could appear tappable with no query and do nothing. | Disabled when unavailable/empty and added disabled styling. |
| Follow | Add selected user as friend and return to list. | Handler present, but local/mock insert behavior depended on incomplete mutation support. | Fixed mock Supabase mutation chaining. |
| Unfollow | Confirm, remove friend, refresh list. | Native handler present; web confirmation could fail to invoke the destructive action, and mock `delete().eq(...)` chaining was unsupported. | Added web-safe confirmation and fixed mock delete chaining. |
| Invite Generate | Generate an invite link. | Functional mock link generation. | No change. |
| Invite Copy Link | Copy invite link. | Web worked with fallback; native only logged to console. | Added `expo-clipboard` and real clipboard writes. |
| Invite Share via SMS | Open SMS composer with invite text. | Functional when a link exists. | No change. |
| Invite Share via Email | Open email composer with invite text. | Functional when a link exists. | No change. |

## Profile (`app/(tabs)/profile.tsx`)

| Element | Expected behavior | Actual before fix | Result |
| --- | --- | --- | --- |
| Avatar / Add Photo / Change Photo | Pick an image and persist avatar URL. | Handler present, but local/mock profile update chaining was unsupported. | Fixed mock Supabase update chaining. |
| Remove photo | Remove avatar URL. | Handler present, but local/mock profile update chaining was unsupported. | Fixed mock Supabase update chaining. |
| Edit | Enter profile edit mode. | Functional. | No change. |
| Cancel | Restore current profile values and exit edit mode. | Functional. | No change. |
| Save | Persist profile details and exit edit mode. | Handler present, but local/mock profile update chaining was unsupported. | Fixed mock Supabase update chaining. |
| Sign Out | Confirm, sign out, navigate to login. | Native handler present; web confirmation could fail to invoke the destructive action. | Added web-safe confirmation. |
| Invite Generate / Copy / SMS / Email | Same as Friends invite section. | Copy was native console-only. | Added real clipboard writes. |
