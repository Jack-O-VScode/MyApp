/* Where this copy of the app connects.

   These three values are the same on every device, so they live here instead
   of being typed into each one. Setting up a new device is then just an email
   and a password.

   All three are public by design — they identify the project and the sender,
   they do not grant access to anything:

   - the anon key only reaches rows that row-level security allows, and every
     policy in the setup SQL is scoped to `auth.uid()`, so without signing in
     it can read nothing;
   - the reminder key is the public half of the push pair; the private half
     lives only in the project's function secrets.

   The one thing worth doing once your own devices are enrolled: turn off
   "Allow new users to sign up" in Supabase (Authentication → Sign In /
   Providers). After that these values are of no use to anyone else at all.

   Anyone forking this app should replace them with their own project's, or
   blank them out to get the typed-in setup back.
*/
window.APP_CONFIG = {
  supabaseUrl: 'https://ultuujqysfuxjsmwdkwl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdHV1anF5c2Z1eGpzbXdka3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MjQzMTUsImV4cCI6MjEwNDIwMDMxNX0.lfGAiNiHgfoCE9iEV59ABMZfEE8vlmPWRmHexSK-7lQ',
  vapidPublicKey: 'BLJbs8UQLOM71WGK08WaC9AVMvYtWe_qnWk1tZt20pm4FHDTilLw1icr-rL7vNwa9Y36ag2ylO1cBhe5eQQCKgs'
};
