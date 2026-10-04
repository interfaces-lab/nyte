import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AccountProvider } from "../../account/provider.tsx";

function App() {
  const [count, setCount] = useState(0);

  return (
    <button id="count" onClick={() => setCount(count + 1)}>
      {count}
    </button>
  );
}

createRoot(document.body).render(
  <AccountProvider publishableKey={`pk_test_${btoa("clerk.example.com$")}`}>
    <App />
  </AccountProvider>,
);
