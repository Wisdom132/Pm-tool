import './banner.css';

const label = '<p>not markup</p>';

export function Banner({ count = 12 }) {
  return (
    <section className="banner">
      <h1>Ship it on Friday</h1>
      <p className="lead">Small changes, reviewed properly.</p>
      <p>{count} deploys, {label.length} chars</p>
      <p>Read our <a href="/guide">guide</a></p>
    </section>
  );
}
