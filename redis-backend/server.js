const express = require('express');
const redis = require('redis');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const Papa = require('papaparse');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

// Connect to Redis
const client = redis.createClient({
  url: 'redis://127.0.0.1:6379' // Removed unnecessary '@'
});

client.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

client.connect()
  .then(() => console.log('✅ Connected to Redis'))
  .catch(err => {
    console.error('❌ Redis connection failed:', err);
    process.exit(1); // Exit the process if Redis fails
  });


// CRUD Operations
// Use CORS to allow requests from the frontend
app.use(cors());

// ✅ Multer configuration (stores uploaded files in 'uploads/' folder)
const upload = multer({ dest: "uploads/" });

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}



// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Route to save student data
app.post('/students', async (req, res) => {
  const { id, name, course, age, address , year_level, college, hobbies} = req.body;

  // Validate input fields
  if (!id || !name || !course || !age || !address || !year_level || !college || !hobbies) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    // Set student data in Redis (using object syntax for Redis v4 and above)
    const studentData = { name, course, age, address , year_level, college, hobbies};

    // Save student data in Redis hash
    await client.hSet(`student:${id}`, 'name', studentData.name);
    await client.hSet(`student:${id}`, 'course', studentData.course);
    await client.hSet(`student:${id}`, 'age', studentData.age);
    await client.hSet(`student:${id}`, 'address', studentData.address);
    await client.hSet(`student:${id}`, 'year_level', studentData.year_level);
    await client.hSet(`student:${id}`, 'college', studentData.college);
    await client.hSet(`student:${id}`, 'hobbies', studentData.hobbies);

    // Respond with success message
    res.status(201).json({ message: 'Student saved successfully' });
  } catch (error) {
    console.error('Error saving student:', error);
    res.status(500).json({ message: 'Failed to save student' });
  }
});

const csv = require('csv-parser');

//CSV//
app.post("/students/upload", upload.single("file"), (req, res) => {
  console.log("📥 Received a request to upload a file...");

  if (!req.file && (!req.files || req.files.length === 0)) {
    console.error("❌ No file uploaded.");
    return res.status(400).json({ message: "No file uploaded." });
  }
  

  const results = [];
  const expectedHeaders = ["id", "name", "course", "age", "address", "year_level", "college", "hobbies"];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("headers", (headers) => {
      const trimmedHeaders = headers.map((h) => h.trim().toLowerCase());

      if (!expectedHeaders.every((header, index) => header === trimmedHeaders[index])) {
        throw new Error("Invalid CSV format: Headers do not match expected structure.");
      }
    })
    .on("data", (data) => {
      // Ensure no extra spaces in values
      const student = Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key.trim(), value ? value.trim() : "N/A"])
      );
      results.push(student);
    })
    .on("end", async () => {
      try {
        if (!client.isReady) {
          console.error("❌ Redis client is not connected.");
          return res.status(500).json({ message: "Redis database is unavailable." });
        }

        for (const student of results) {
          const { id, name, course, age, address, year_level, college, hobbies } = student;

          if (!id || !name || !course || !age || !address || !year_level || !college || !hobbies) {
            console.warn(`⚠️ Skipping invalid row: ${JSON.stringify(student)}`);
            continue;
          }

          const studentKey = `student:${id}`;
          console.log(`📝 Saving to Redis: ${studentKey}`, student);

          // ✅ Corrected `hSet` format
          await client.hSet(studentKey,
            "name", name,
            "course", course,
            "age", age,
            "address", address,
            "year_level", year_level,
            "college", college,
            "hobbies", hobbies
          );
        }

        console.log("✅ CSV data uploaded and saved successfully.");
        res.status(201).json({ message: "CSV data uploaded and saved successfully." });
      } catch (error) {
        console.error("❌ Error processing file:", error);
        res.status(500).json({ message: "Error processing file.", error: error.message });
      } finally {
        fs.unlinkSync(req.file.path);
        console.log("🗑️ Uploaded file deleted.");
      }
    })
    .on("error", (error) => {
      console.error("CSV parsing error:", error);
      res.status(400).json({ message: "Invalid CSV format" });
      fs.unlinkSync(req.file.path);
    });
});



// Read (R)
app.get('/students/:id', async (req, res) => {
  const id = req.params.id;
  const student = await client.hGetAll(`student:${id}`);
  if (Object.keys(student).length === 0) {
    return res.status(404).json({ message: 'Student not found' });
  }
  res.json(student);
});

// Read all students
app.get('/students', async (req, res) => {
  const keys = await client.keys('student:*');
  const students = await Promise.all(keys.map(async (key) => {
    return { id: key.split(':')[1], ...(await client.hGetAll(key)) };
  }));
  res.json(students);
});

// Update (U)
app.put('/students/:id', async (req, res) => {
  const id = req.params.id;
  const { name, course, age, address , year_level, college, hobbies} = req.body;

  if (!Object.keys(req.body).length) {
    return res.status(400).json({ message: 'No fields provided for update' });
  }
  
  if (!name && !course && !age && !address && !year_level && !college && !hobbies) {
    return res.status(400).json({ message: 'At least one field is required to update' });
  }

  try {
    const existingStudent = await client.hGetAll(`student:${id}`);
    if (Object.keys(existingStudent).length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Update student data in Redis
    if (name) await client.hSet(`student:${id}`, 'name', name);
    if (course) await client.hSet(`student:${id}`, 'course', course);
    if (age) await client.hSet(`student:${id}`, 'age', age);
    if (address) await client.hSet(`student:${id}`, 'address', address);
    if (year_level) await client.hSet(`student:${id}`, 'year_level', year_level);
    if (college) await client.hSet(`student:${id}`, 'college', college);
    if (hobbies) await client.hSet(`student:${id}`, 'hobbies', hobbies);

    res.status(200).json({ message: 'Student updated successfully' });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ message: 'Failed to update student' });
  }
});

// Delete (D)
app.delete('/students/:id', async (req, res) => {
  const id = req.params.id;
  await client.del(`student:${id}`);
  res.status(200).json({ message: 'Student deleted successfully' });
});