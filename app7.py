from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from ultralytics import YOLO
import openai
import base64
import os
import io
import time
from datetime import datetime
import requests
import logging
import numpy as np
import cv2

# Initialize Flask app
app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
app.logger.setLevel(logging.INFO)

# Load API key
openai.api_key = os.getenv("OPENAI_API_KEY")
if not openai.api_key:
    app.logger.warning("⚠️ OPENAI_API_KEY not set, using placeholder")
    openai.api_key = "your-openai-key-here"  # Will cause API calls to fail

# Ensure directories exist
os.makedirs('static', exist_ok=True)
os.makedirs('static/frames', exist_ok=True)

# Load YOLO model
try:
    model = YOLO('yolov8n.pt')
    app.logger.info("✅ YOLOv8n loaded")
except Exception as e:
    app.logger.exception("❌ Failed to load YOLO model")
    raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    """Endpoint to transcribe audio using Whisper API"""
    try:
        # Check if audio file was included in request
        if 'audio' not in request.files:
            app.logger.error("No audio file in request")
            return jsonify(error="No audio file"), 400
        
        audio_file = request.files['audio']
        
        # Save audio temporarily
        temp_path = f"static/audio_{int(time.time())}.webm"
        audio_file.save(temp_path)
        app.logger.info(f"Saved audio to {temp_path}")
        
        # Transcribe with Whisper API
        try:
            with open(temp_path, "rb") as file:
                transcription = openai.audio.transcriptions.create(
                    model="whisper-1",
                    file=file
                )
            
            text = transcription.text
            app.logger.info(f"Transcribed: {text}")
            
            # Clean up
            os.remove(temp_path)
            
            return jsonify({"text": text})
            
        except Exception as e:
            app.logger.exception("Whisper API error")
            return jsonify(error=f"Transcription error: {str(e)}"), 500
        
    except Exception as e:
        app.logger.exception("Transcription handler error")
        return jsonify(error=str(e)), 500

@app.route('/query', methods=['POST'])
def query():
    """Main endpoint handling vision, text and location data"""
    try:
        data = request.get_json(force=True)
        speech = data.get('text', '').strip()
        img_b64 = data.get('image', '')
        
        if not speech and not img_b64:
            raise ValueError("Missing both 'text' and 'image' - at least one is required")
        
        # Default values
        path = None
        obj = "no image provided"
        detected_objects = []
        
        # Process image if provided
        if img_b64:
            # Save image to disk
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            fname = f"frame_{timestamp}.jpg"
            path = os.path.join('static', 'frames', fname)
            
            try:
                # Extract actual base64 content (after comma)
                if ',' in img_b64:
                    img_data = img_b64.split(',', 1)[1]
                else:
                    img_data = img_b64
                    
                with open(path, 'wb') as f:
                    f.write(base64.b64decode(img_data))
                app.logger.info(f"Saved image {path}")
                
                # Object detection
                res = model(path)[0]
                
                # Get all detected objects with confidence
                detected_objects = []
                for box, conf, cls_id in zip(res.boxes.xyxy, res.boxes.conf, res.boxes.cls):
                    x1, y1, x2, y2 = box.tolist()
                    class_name = res.names[int(cls_id)]
                    confidence = float(conf)
                    
                    # Only include objects with confidence > 0.4
                    if confidence > 0.4:
                        detected_objects.append({
                            "object": class_name,
                            "confidence": confidence,
                            "position": {
                                "x1": int(x1), 
                                "y1": int(y1), 
                                "x2": int(x2), 
                                "y2": int(y2)
                            }
                        })
                
                if detected_objects:
                    # Sort by confidence
                    detected_objects.sort(key=lambda x: x["confidence"], reverse=True)
                    # Primary object is the one with highest confidence
                    obj = detected_objects[0]["object"]
                    
                    # Optional: Annotate the image with bounding boxes for debugging
                    """
                    img = cv2.imread(path)
                    for det in detected_objects:
                        box = det["position"]
                        cv2.rectangle(img, (box["x1"], box["y1"]), (box["x2"], box["y2"]), (0, 255, 0), 2)
                        cv2.putText(img, f"{det['object']} {det['confidence']:.2f}", 
                                   (box["x1"], box["y1"]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                    cv2.imwrite(path.replace('.jpg', '_annotated.jpg'), img)
                    """
                else:
                    obj = "nothing recognizable"
                
                app.logger.info(f"Detected: {obj}, total objects: {len(detected_objects)}")
                
            except Exception as img_err:
                app.logger.exception(f"Image processing error: {img_err}")
                obj = "error processing image"
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except:
                        pass
        
        # Geolocation
        location_info = {}
        try:
            loc_response = requests.get('https://ipapi.co/json/', timeout=3)
            if loc_response.status_code == 200:
                location_info = loc_response.json()
                location = f"You are in {location_info.get('city', 'unknown city')}, {location_info.get('region', '')}, {location_info.get('country_name', 'unknown country')}"
                app.logger.info(f"Location: {location}")
            else:
                location = "Unable to fetch location."
                app.logger.warning(f"Geolocation API returned status code: {loc_response.status_code}")
        except Exception as loc_err:
            app.logger.exception(f"Geolocation error: {loc_err}")
            location = "Unable to fetch location due to an error."
        
        # Prepare context for GPT
        context = []
        
        # Add detected objects to context
        if detected_objects:
            obj_descriptions = []
            for i, det in enumerate(detected_objects[:5]):  # Limit to top 5 objects
                # Add position description (left/right/center, top/bottom)
                pos = det["position"]
                x_center = (pos["x1"] + pos["x2"]) / 2
                y_center = (pos["y1"] + pos["y2"]) / 2
                
                # Simple positioning description
                x_pos = "left" if x_center < 213 else "right" if x_center > 426 else "center"
                y_pos = "top" if y_center < 160 else "bottom" if y_center > 320 else "middle"
                
                size = (pos["x2"] - pos["x1"]) * (pos["y2"] - pos["y1"])
                size_desc = "large" if size > 40000 else "small" if size < 10000 else "medium"
                
                obj_descriptions.append(f"{det['object']} ({size_desc}, {x_pos}-{y_pos})")
            
            context.append(f"Camera sees: {', '.join(obj_descriptions)}")
        else:
            context.append("Camera cannot identify any objects clearly.")
        
        # Add location data
        if location_info:
            context.append(location)
        
        # Add user query
        if speech:
            context.append(f"User asked: '{speech}'")
        
        # Combine all context
        prompt = ". ".join(context)
        prompt += ". Please provide brief guidance to help this visually impaired user navigate or understand their surroundings based on this information."
        
        app.logger.info(f"GPT Prompt: {prompt}")
        
        # Call GPT-4o
        try:
            resp = openai.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "system", "content": "You are a helpful assistant for visually impaired users. Provide clear, concise guidance based on camera input and user questions. Be brief but informative, focusing on practical navigation help and environmental awareness."},
                          {"role": "user", "content": prompt}],
                max_tokens=150  # Keep responses concise
            )
            reply = resp.choices[0].message.content.strip()
            app.logger.info(f"GPT reply: {reply}")
        except Exception as oe:
            app.logger.error("OpenAI API call failed", exc_info=oe)
            # Don't delete image on error - might be useful for debugging
            return jsonify(error=f"GPT response error: {str(oe)}"), 502
        
        # Clean up - optionally keep images for debugging
        if path and os.path.exists(path):
            try:
                # Comment this line if you want to keep images for debugging
                os.remove(path)
                app.logger.info(f"Deleted frame: {path}")
            except Exception as rm_e:
                app.logger.warning(f"Failed to delete frame: {path} - {rm_e}")
        
        return jsonify({
            "reply": reply,
            "object": obj,
            "detected_objects": detected_objects,
            "location": location,
            "image_path": None if path is None else f"/frames/{os.path.basename(path)}" if os.path.exists(path) else None
        })
        
    except Exception as e:
        app.logger.exception("/query handler error")
        return jsonify(error=str(e)), 500

# Add a health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify(status="ok", message="Server is running")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8501))
    app.run(host='0.0.0.0', port=port, debug=False)
