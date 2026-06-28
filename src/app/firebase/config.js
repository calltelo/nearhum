// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFunctions } from "firebase/functions";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage"; // Add this line
import { getPerformance } from "firebase/performance";


const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase (single initialization guard)
let firebase_app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Analytics only on the client-side
(function () {
  if (typeof window !== "undefined") {
    getAnalytics(firebase_app);
  }
})();

// Initialize Performance Monitoring only on the client-side
if (typeof window !== "undefined") {
  const perf = getPerformance(firebase_app);
}

// Initialize Authentication
const auth = getAuth(firebase_app);

// Initialize Functions
const functions = getFunctions(firebase_app);


// Initialize Firestore
const firestore = getFirestore(firebase_app);

// Initialize Storage
const storage = getStorage(firebase_app); // Add this line

// Export the storage object
export { firebase_app, functions, firestore, auth, httpsCallable, storage, ref, uploadBytesResumable, getDownloadURL };