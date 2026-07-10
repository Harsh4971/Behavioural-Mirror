def extract_text(response) -> str:
    """Anthropic responses can include a thinking block ahead of the text block
    on longer/harder prompts — content[0] isn't reliably the text, so find the
    text block by type instead of assuming position."""
    for block in response.content:
        if block.type == "text":
            return block.text
    return ""
