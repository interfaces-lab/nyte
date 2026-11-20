export default function Menu() {
  return (
    <>
      <section
        data-frame="Menu"
        data-x="40"
        data-y="24"
        style={{ width: 240, height: 140, padding: 16, boxSizing: "border-box" }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>Tonight</h1>
        <p>Three courses, one table.</p>
      </section>
      <section
        data-frame="Specials"
        data-x={360}
        data-y={24}
        style={{ width: 200, height: 140, padding: 16, boxSizing: "border-box" }}
      >
        <p>Soup of the day</p>
      </section>
    </>
  );
}
