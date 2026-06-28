import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentTitle,
} from "./attachment";
import { BubbleContent } from "./bubble";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller";
import { Message, MessageContent } from "./message";

describe("chat UI primitives", () => {
  test("message scroller exposes anchors and scroll fade viewport styling", () => {
    const html = renderToStaticMarkup(
      <MessageScrollerProvider defaultScrollPosition="last-anchor">
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent>
              <MessageScrollerItem messageId="u1" role="user" scrollAnchor>
                <p>Hello</p>
              </MessageScrollerItem>
              <MessageScrollerItem
                messageId="a1"
                role="assistant"
                scrollAnchor={false}
              >
                <p>Hi</p>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>,
    );

    expect(html).toContain('data-slot="message-scroller"');
    expect(html).toContain('data-slot="message-scroller-viewport"');
    expect(html).toContain("scroll-fade-y");
    expect(html).toContain('data-scroll-anchor=""');
    expect(html).toContain('data-message-role="assistant"');
  });

  test("attachment group exposes a scroll fade row", () => {
    const html = renderToStaticMarkup(
      <AttachmentGroup>
        <Attachment>
          <AttachmentContent>
            <AttachmentTitle>notes.txt</AttachmentTitle>
          </AttachmentContent>
        </Attachment>
      </AttachmentGroup>,
    );

    expect(html).toContain('data-slot="attachment-group"');
    expect(html).toContain("scroll-fade-x");
    expect(html).toContain("notes.txt");
  });

  test("message rows compose with bubble content", () => {
    const html = renderToStaticMarkup(
      <Message align="end" variant="user">
        <MessageContent align="end" variant="user">
          <BubbleContent align="end" variant="user">Ship it</BubbleContent>
        </MessageContent>
      </Message>,
    );

    expect(html).toContain('data-slot="message"');
    expect(html).toContain('data-slot="message-content"');
    expect(html).toContain('data-slot="bubble-content"');
    expect(html).toContain("Ship it");
  });
});
