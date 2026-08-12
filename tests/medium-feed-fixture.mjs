export const mediumFeedFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
  <channel>
    ${Array.from({ length: 6 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      const day = String(10 - index).padStart(2, "0");
      return `<item>
        <title><![CDATA[MEDIUM POST ${number}]]></title>
        <link>https://medium.com/@30ozsteak/medium-post-${number}?source=rss#story</link>
        <guid isPermaLink="false">https://medium.com/p/post-${number}</guid>
        <pubDate>Mon, ${day} Aug 2026 12:00:00 GMT</pubDate>
        <atom:updated>2026-08-${day}T12:00:00.000Z</atom:updated>
      </item>`;
    }).join("\n")}
  </channel>
</rss>`;
