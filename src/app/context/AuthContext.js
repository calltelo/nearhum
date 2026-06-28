import React, { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged, getAuth } from 'firebase/auth';
import Loader from '@/App/Loader';
import { firebase_app } from '@/firebase/config'; // Ensure this path is correct

const auth = getAuth(firebase_app);

export const AuthContext = createContext({});

export const useAuthContext = () => useContext(AuthContext);

export const AuthContextProvider = ({ children }) => {
  const [uid, setUid] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUid(user.uid);
      } else {
        setUid(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ uid }}>
      {loading ? <Loader /> : children}
    </AuthContext.Provider>
  );
};
