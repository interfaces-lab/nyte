export default function Notes() {
  const words = "Third draft";

  if (words !== "") throw new Error("Notes broke while drawing");

  return (
    <article data-frame="Notes" data-x="0" data-y="0" style={{ width: 200, height: 120 }}>
      <p>{words}</p>
    </article>
  );
}
