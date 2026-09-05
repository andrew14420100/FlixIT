#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime

class FlixITAPITester:
    def __init__(self, base_url="https://flix-it-preview.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.results = []

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        if headers is None:
            headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and 'items' in response_data:
                        print(f"   Response contains {len(response_data['items'])} items")
                    elif isinstance(response_data, dict) and 'status' in response_data:
                        print(f"   Status: {response_data['status']}")
                except:
                    print(f"   Response length: {len(response.text)} chars")
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")

            self.results.append({
                "test": name,
                "method": method,
                "endpoint": endpoint,
                "expected_status": expected_status,
                "actual_status": response.status_code,
                "success": success,
                "response_preview": response.text[:100] if response.text else ""
            })

            return success, response.json() if success and response.text else {}

        except requests.exceptions.Timeout:
            print(f"❌ Failed - Request timeout")
            self.results.append({
                "test": name,
                "method": method,
                "endpoint": endpoint,
                "expected_status": expected_status,
                "actual_status": "TIMEOUT",
                "success": False,
                "error": "Request timeout"
            })
            return False, {}
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.results.append({
                "test": name,
                "method": method,
                "endpoint": endpoint,
                "expected_status": expected_status,
                "actual_status": "ERROR",
                "success": False,
                "error": str(e)
            })
            return False, {}

    def test_health_check(self):
        """Test health check endpoint"""
        return self.run_test("Health Check", "GET", "api/health", 200)

    def test_public_endpoints(self):
        """Test public API endpoints"""
        endpoints = [
            ("Public Menu", "GET", "api/public/menu", 200),
            ("Trending Movies", "GET", "api/public/tmdb/trending/movie", 200),
            ("Popular Movies", "GET", "api/public/tmdb/popular/movie", 200),
            ("Top Rated Movies", "GET", "api/public/tmdb/top_rated/movie", 200),
            ("Now Playing Movies", "GET", "api/public/tmdb/now_playing", 200),
            ("Popular TV Shows", "GET", "api/public/tmdb/popular/tv", 200),
            ("Top Rated TV Shows", "GET", "api/public/tmdb/top_rated/tv", 200),
            ("TV On The Air", "GET", "api/public/tmdb/on_the_air", 200),
            ("Home Contents", "GET", "api/public/contents/home", 200),
        ]
        
        results = []
        for name, method, endpoint, expected_status in endpoints:
            success, response = self.run_test(name, method, endpoint, expected_status)
            results.append(success)
        
        return results

    def test_homepage_specific_endpoints(self):
        """Test homepage specific endpoints"""
        endpoints = [
            ("Homepage Trending", "GET", "api/public/homepage/trending", 200),
            ("Homepage Latest", "GET", "api/public/homepage/latest", 200),
            ("Top 10", "GET", "api/public/top10", 200),
        ]
        
        results = []
        for name, method, endpoint, expected_status in endpoints:
            success, response = self.run_test(name, method, endpoint, expected_status)
            results.append(success)
        
        return results

    def print_summary(self):
        """Print test summary"""
        print(f"\n{'='*50}")
        print(f"📊 TEST SUMMARY")
        print(f"{'='*50}")
        print(f"Tests run: {self.tests_run}")
        print(f"Tests passed: {self.tests_passed}")
        print(f"Tests failed: {self.tests_run - self.tests_passed}")
        print(f"Success rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        
        # Show failed tests
        failed_tests = [r for r in self.results if not r['success']]
        if failed_tests:
            print(f"\n❌ FAILED TESTS:")
            for test in failed_tests:
                error_msg = test.get('error', f'Status {test.get("actual_status", "unknown")}')
                print(f"   - {test['test']}: {error_msg}")
        
        return self.tests_passed == self.tests_run

def main():
    print("🎬 FlixIT Netflix Clone - Backend API Testing")
    print("=" * 60)
    
    tester = FlixITAPITester()
    
    # Test health check first
    print("\n🏥 HEALTH CHECK")
    health_success, _ = tester.test_health_check()
    
    if not health_success:
        print("❌ Health check failed - backend may be down")
        tester.print_summary()
        return 1
    
    # Test public endpoints
    print("\n🌐 PUBLIC API ENDPOINTS")
    public_results = tester.test_public_endpoints()
    
    # Test homepage specific endpoints
    print("\n🏠 HOMEPAGE SPECIFIC ENDPOINTS")
    homepage_results = tester.test_homepage_specific_endpoints()
    
    # Print final summary
    success = tester.print_summary()
    
    # Save results to file
    with open('/app/backend_test_results.json', 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "total_tests": tester.tests_run,
            "passed_tests": tester.tests_passed,
            "success_rate": (tester.tests_passed/tester.tests_run*100) if tester.tests_run > 0 else 0,
            "results": tester.results
        }, f, indent=2)
    
    print(f"\n📄 Detailed results saved to: /app/backend_test_results.json")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())