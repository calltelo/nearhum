import { firebase_app } from "@/firebase/config";
import { getAuth, signOut } from "firebase/auth";

const auth = getAuth(firebase_app);

export default async function signOutUser() {
  try {
    await signOut(auth);
    console.log('User signed out successfully');
  } catch (error) {
    console.log(error.message);
  }
}
