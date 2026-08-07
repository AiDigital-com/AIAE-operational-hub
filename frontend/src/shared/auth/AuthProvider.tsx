import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ReactNode, useEffect } from "react";
import { runtimeConfig, setSsoTokenGetter } from "../config/runtime";

interface Props {
  children: ReactNode;
}

export function AuthProvider({ children }: Props) {
  return (
    <ClerkProvider publishableKey={runtimeConfig.clerkPublishableKey}>
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  );
}

function ClerkTokenBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setSsoTokenGetter(() => getToken({ template: runtimeConfig.clerkJwtTemplate }));
    return () => setSsoTokenGetter(null);
  }, [getToken]);

  return null;
}
