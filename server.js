const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8005;
const PUBLIC_DIR = __dirname; // Serve files from the current directory

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const clients = [];

const server = http.createServer((req, res) => {
  // Clean URL to prevent directory traversal
  let safeUrl = req.url.split('?')[0];
  if (safeUrl === '/') {
    safeUrl = '/index.html';
  }
  
  // Decode URL
  safeUrl = decodeURIComponent(safeUrl);
  
  // Intercept the API sync endpoint
  if (safeUrl === '/api/sync') {
    // Add CORS headers for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    const dbPath = path.join(PUBLIC_DIR, 'db.json');
    
    if (req.method === 'GET') {
      fs.readFile(dbPath, 'utf8', (err, data) => {
        if (err) {
          // If file doesn't exist, return empty object
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({}));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(data);
        }
      });
      return;
    }
    
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        fs.writeFile(dbPath, body, 'utf8', (err) => {
          if (err) {
            console.error('Error writing db.json:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to write database' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));

            // Notify all connected SSE clients of the updated data
            try {
              const remoteData = JSON.parse(body);
              const payload = JSON.stringify({ type: 'update', data: remoteData });
              clients.forEach(client => {
                try {
                  client.write(`data: ${payload}\n\n`);
                } catch (writeErr) {
                  console.error('Error writing to client SSE connection:', writeErr);
                }
              });
            } catch (e) {
              console.error('Failed to notify clients of update:', e);
            }
          }
        });
      });
      return;
    }
  }

  // Intercept the SSE updates endpoint
  if (safeUrl === '/api/updates') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send a connection established message
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    clients.push(res);

    req.on('close', () => {
      const index = clients.indexOf(res);
      if (index !== -1) {
        clients.splice(index, 1);
      }
    });
    return;
  }
  
  // Static files server logic
  const filePath = path.join(PUBLIC_DIR, safeUrl);
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  
  // Detect local network IP addresses
  const networkInterfaces = os.networkInterfaces();
  const localIPs = [];
  
  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
      // Look for non-internal IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        localIPs.push(iface.address);
      }
    }
  }
  
  if (localIPs.length > 0) {
    console.log(`To access from other devices on the same network, use:`);
    localIPs.forEach(ip => {
      console.log(`  http://${ip}:${PORT}/`);
    });
  } else {
    console.log(`To access from other devices on the same network, use the computer's local IP address.`);
  }
});
