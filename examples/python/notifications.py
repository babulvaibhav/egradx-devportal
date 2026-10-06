"""The messages this application sends."""

from pathlib import Path

from egradx.sdk import EgradxNotificationType

from notes import NOTE_CREATED

# docs:region notification-type
# A type names the variables its templates may use; the templates live in notification-templates/<key>/, and the
# application does not start if one uses a variable the type does not declare.
NOTIFICATION_TYPES = [
    EgradxNotificationType.builder(NOTE_CREATED)
    .description("Sent to the author of a new note")
    .requires("title")
    .user_can_opt_out()  # people may turn it off on their settings screen
    .build(),
]

TEMPLATE_DIRECTORY = Path(__file__).parent / "notification-templates"
# docs:end
