from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from ultralytics import YOLO
import openai, base64, os, io
from datetime import datetime
import requests
import logging
from PIL import Image

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
app.logger.setLevel(logging.INFO)

# Load API key
openai.api_key = 

# Ensure static directory exists
os.makedirs('static', exist_ok=True)

# Load YOLO model
try:
    model = YOLO('yolov8n.pt')
    app.logger.info("✅ YOLOv8n loaded")
except Exception:
    app.logger.exception("❌ Failed to load YOLO model")
    raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/query', methods=['POST'])
def query():
    try:
        data = request.get_json(force=True)
        audio_data = data.get('audio', '')  # Get audio data if present
        speech = data.get('text', '')
        img_b64 = data.get('image', '')
        
        if not img_b64:
            return jsonify(error="Missing image data"), 400
            
        # Process speech input through Whisper if audio data is provided
        if audio_data and not speech:
            try:
                app.logger.info("Transcribing audio with Whisper")
                audio_bytes = base64.b64decode(audio_data.split(',', 1)[1])
                
                # Save audio temporarily
                temp_audio_path = os.path.join('static', f"audio_{datetime.now().strftime('%H%M%S')}.webm")
                with open(temp_audio_path, 'wb') as f:
                    f.write(audio_bytes)
                
                # Transcribe with Whisper
                with open(temp_audio_path, "rb") as audio_file:
                    transcription = openai.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file
                    )
                speech = transcription.text
                app.logger.info(f"Whisper transcription: {speech}")
                
                # Clean up temp audio file
                try:
                    os.remove(temp_audio_path)
                except Exception as e:
                    app.logger.warning(f"Failed to delete temp audio: {e}")
                    
            except Exception as e:
                app.logger.error(f"Whisper transcription error: {e}")
                speech = ""  # Set empty if transcription fails
        
        # If we still don't have speech, set a default
        if not speech.strip():
            speech = "Describe what you see and tell me where I am."
            
        # Save image to disk
        fname = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
        path = os.path.join('static', fname)
        
        try:
            # Decode and save the image
            img_data = base64.b64decode(img_b64.split(',', 1)[1])
            with open(path, 'wb') as f:
                f.write(img_data)
            app.logger.info(f"Saved image {path}")
            
            # Convert to base64 for GPT-4o vision
            with open(path, "rb") as img_file:
                base64_image = base64.b64encode(img_file.read()).decode('utf-8')
        except Exception as e:
            app.logger.error(f"Image processing error: {e}")
            return jsonify(error=f"Image processing error: {e}"), 500

        # Object detection with YOLO
        try:
            res = model(path)[0]
            cls = res.boxes.cls
            names = res.names
            
            # Get all detected objects, not just the first one
            objects = []
            if cls.nelement() > 0:
                for c in cls:
                    objects.append(names[int(c)])
                obj_str = ", ".join(objects)
            else:
                obj_str = 'nothing recognizable'
            
            app.logger.info(f"Detected: {obj_str}")
        except Exception as e:
            app.logger.error(f"YOLO detection error: {e}")
            obj_str = "Error in object detection"

        # Geolocation - more robust implementation
        try:
            loc = requests.get('https://ipapi.co/json/', timeout=5).json()
            if 'error' in loc:
                location = "Unable to fetch precise location."
            else:
                city = loc.get('city', 'Unknown city')
                country = loc.get('country_name', 'Unknown country')
                location = f"You are in {city}, {country}"
                
                # Add more detailed location info if available
                if loc.get('latitude') and loc.get('longitude'):
                    location += f". Coordinates: {loc.get('latitude')}, {loc.get('longitude')}"
        except Exception as e:
            app.logger.exception("Geolocation error")
            location = 'Unable to fetch location due to a connection issue.'
        
        app.logger.info(f"Location: {location}")

        # GPT-4o with vision capabilities
        try:
            prompt = f"""
You are an AI assistant for a visually impaired person. 
User said: "{speech}"
Detected objects in view: {obj_str}
{location}

Provide a helpful, clear, and concise response that:
1. Describes the scene they're looking at
2. Mentions any obstacles or important elements they should be aware of
3. Provides guidance based on their location
4. Answers any specific questions they asked

Keep your response brief and focused on helping them navigate or understand their surroundings.
"""
            # Use GPT-4o with vision
            response = openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text", 
                                "text": prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=300
            )
            
            reply = response.choices[0].message.content.strip()
            app.logger.info(f"GPT response: {reply}")
            
        except Exception as oe:
            app.logger.error(f"OpenAI API call failed: {oe}", exc_info=True)
            # cleanup the saved frame even on error
            try:
                os.remove(path)
                app.logger.info(f"Deleted frame after error: {path}")
            except Exception as rm_err:
                app.logger.warning(f"Failed to delete frame: {path} - {rm_err}")
            return jsonify(error=f"OpenAI API error: {str(oe)}"), 502

        # Clean up saved file after processing
        try:
            os.remove(path)
            app.logger.info(f"Deleted frame: {path}")
        except Exception as rm_e:
            app.logger.warning(f"Failed to delete frame: {path} - {rm_e}")
            
        # Return detailed response to client
        return jsonify({
            "reply": reply,
            "objects": objects if cls.nelement() > 0 else [],
            "location": location,
            "speech_recognized": speech
        })
        
    except Exception as e:
        app.logger.exception("Query handler error")
        return jsonify(error=str(e)), 500

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify(status="ok", message="Server is running")

if __name__ == '__main__':
    app.logger.info("Starting Vision Assistant server on port 8501")
    app.run(host='0.0.0.0', port=8501, debug=False)
