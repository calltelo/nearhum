import { firebase_app } from '@/firebase/config';
import { getFirestore, doc, setDoc } from "firebase/firestore";

const db = getFirestore(firebase);

export default async function updateData(collection, id, data) {
  let result = null;
  let error = null;

  try {
    const docRef = doc(db, collection, id);
    result = await setDoc(docRef, data, { merge: true });
  } catch (e) {
    error = e;
  }

  return { result, error };
}