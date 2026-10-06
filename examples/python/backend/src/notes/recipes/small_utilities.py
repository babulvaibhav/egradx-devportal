"""The core utilities a recipe or guide shows."""

from egradx.sdk import (
    generate_random_string,
    get_unzipped_content,
    get_zipped_content,
    open_secret_text,
    seal_secret_text,
    uuid_v7,
)


# docs:region seal-a-secret
async def seal(api_key: str, passphrase: str) -> str:
    """A secret kept in one column: AES-256-GCM with a key wrapped under the passphrase, as one string ("v1:…:…:…")
    that Java, Node and Python all read."""
    return await seal_secret_text(api_key, passphrase)


async def open_sealed(sealed: str, passphrase: str) -> str:
    return await open_secret_text(sealed, passphrase)  # a wrong passphrase or a changed value raises
# docs:end


# docs:region small-utilities
def examples() -> None:
    code = generate_random_string(12)  # A–Z, a–z, 0–9, from a secure source
    note_id = uuid_v7()  # time-ordered: new rows land at the index's end
    zipped = get_zipped_content("a long text")  # gzip
    text = get_unzipped_content(zipped)
    print(code, note_id, text)
# docs:end
