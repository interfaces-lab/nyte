const greeting = "Hello";

if (greeting !== "") throw new Error("Broken on purpose");

export default function Broken() {
  return (
    <div data-frame="Broken" data-x="0" data-y="0" style={{ width: 200, height: 120 }}>
      {greeting}
    </div>
  );
}
