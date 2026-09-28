<script>
  const label = '<p>not markup</p>';
  let count = 12;
</script>

<section class="banner">
  <h1>Ship it on Friday</h1>
  <p class="lead">Small changes, reviewed properly.</p>
  <p>{count} deploys, {label.length} chars</p>
  <p>Read our <a href="/guide">guide</a></p>
</section>

<style>
  .banner { padding: 22px; }
  p { color: red; }
</style>
