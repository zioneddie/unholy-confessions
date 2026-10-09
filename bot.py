import os
import re
import io
import logging
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, MessageHandler, filters
from PIL import Image, ImageDraw, ImageFont

# Set up logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

BOT_TOKEN = os.getenv("BOT_TOKEN", "8715731116:AAGmr450A0nx_dKlWsLF090lmPVgjdsoQHU")

def wrap_text(text, font, max_width, draw):
    """Wraps text cleanly within a maximum pixel width."""
    words = text.split()
    lines = []
    current_line = []

    for word in words:
        test_line = ' '.join(current_line + [word])
        bbox = draw.textbbox((0, 0), test_line, font=font)
        width = bbox[2] - bbox[0]

        if width <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [word]

    if current_line:
        lines.append(' '.join(current_line))

    return lines

def generate_confession_card(clean_text: str) -> io.BytesIO:
    """Generates an NGL-style dark/gold confession card image."""
    # Canvas dimensions
    width, height = 1080, 1080
    bg_color = (7, 8, 11)  # #07080B dark background
    
    # Create main image
    image = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(image)

    # Card background dimensions
    card_margin_x = 80
    card_margin_y = 120
    card_width = width - (card_margin_x * 2)
    card_height = height - (card_margin_y * 2)

    # Draw Card Background (#10121A with Gold Border)
    card_shape = [card_margin_x, card_margin_y, card_margin_x + card_width, card_margin_y + card_height]
    draw.rounded_rectangle(card_shape, radius=32, fill=(16, 18, 26), outline=(212, 175, 55), width=2)

    # Try loading system default font or Pillow font
    try:
        title_font = ImageFont.truetype("DejaVuSans-Bold.ttf", 44)
        body_font = ImageFont.truetype("DejaVuSans-Bold.ttf", 38)
        footer_font = ImageFont.truetype("DejaVuSans.ttf", 28)
    except IOError:
        title_font = ImageFont.load_default()
        body_font = ImageFont.load_default()
        footer_font = ImageFont.load_default()

    # 1. Header Title: "UNHOLY CONFESSION"
    title_text = "🕯️ UNHOLY CONFESSION"
    title_bbox = draw.textbbox((0, 0), title_text, font=title_font)
    title_w = title_bbox[2] - title_bbox[0]
    draw.text(((width - title_w) / 2, card_margin_y + 60), title_text, font=title_font, fill=(212, 175, 55))

    # 2. Confession Body Text
    max_text_width = card_width - 120
    wrapped_lines = wrap_text(f'"{clean_text}"', body_font, max_text_width, draw)

    # Calculate vertical placement centered in the card
    line_height = 52
    total_text_height = len(wrapped_lines) * line_height
    start_y = card_margin_y + 180 + ((card_height - 320 - total_text_height) / 2)

    for line in wrapped_lines:
        line_bbox = draw.textbbox((0, 0), line, font=body_font)
        line_w = line_bbox[2] - line_bbox[0]
        draw.text(((width - line_w) / 2, start_y), line, font=body_font, fill=(240, 240, 240))
        start_y += line_height

    # 3. Footer Branding: "unholyconfessions.online • @UnholyPriet"
    footer_text = "unholyconfessions.online  •  @UnholyPriet"
    footer_bbox = draw.textbbox((0, 0), footer_text, font=footer_font)
    footer_w = footer_bbox[2] - footer_bbox[0]
    draw.text(((width - footer_w) / 2, card_margin_y + card_height - 70), footer_text, font=footer_font, fill=(150, 150, 150))

    # Save to memory buffer
    bio = io.BytesIO()
    bio.name = 'confession_card.png'
    image.save(bio, 'PNG')
    bio.seek(0)
    return bio

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Processes incoming messages, generates the card, and replies back."""
    if not update.message or not update.message.text:
        return

    text = update.message.text

    # Extract raw confession by stripping out HTML tags and Category/Severity headers
    clean_text = re.sub(r'<[^>]+>', '', text)
    clean_text = re.sub(r'🚨\s*NEW UNHOLY CONFESSION', '', clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r'Category:.*?\n', '', clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r'Severity:.*?\n', '', clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r'Confession:\s*', '', clean_text, flags=re.IGNORECASE)
    clean_text = clean_text.strip().strip('"')

    if not clean_text:
        return

    # Generate Card
    card_buffer = generate_confession_card(clean_text)

    # Send Photo back to Telegram
    await context.bot.send_photo(
        chat_id=update.effective_chat.id,
        photo=card_buffer,
        caption="✨ <b>Card generated! Ready to post on X.</b>",
        parse_mode="HTML"
    )

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message))
    print("Bot is listening for confessions...")
    app.run_polling()

if __name__ == "__main__":
    main()
  
