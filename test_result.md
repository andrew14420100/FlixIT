#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
user_problem_statement: "FlixIT restyling: remove hero black bar/TMDB footer, uniform trailer pipeline (media-assets), titled horizontal covers, Top 10 redesign with uniform hover + edge-aware hover positioning, hero moved up (100vh), infinite scroll rows, new nav menu with placeholder pages."

backend:
  - task: "Media assets pipeline (/api/public/media-assets/{type}/{id}) + enrich_items on all list endpoints"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Returns titled_backdrop_path, logo_path, trailer_key, runtime, number_of_seasons, certification. Cached in Mongo media_assets (14d). Verified via curl on trending (19/19 enriched)."
  - task: "GET /api/public/available-sections + origin_country param on genre endpoint"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Verified via curl."

frontend:
  - task: "Hero 100vh, content moved up, cropped TrailerPlayer (no black bar / watermark), certification badge"
    implemented: true
    working: "NA"
    file: "frontend/src/components/HeroSection.tsx, TrailerPlayer.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Screenshot verified layout. YouTube playback cannot be verified in headless (YouTube returns Video_unavailable for HeadlessChrome)."
  - task: "Uniform hover ExpandedCard (cards + Top 10) with edge-aware alignment (left/center/right)"
    implemented: true
    working: true
    file: "frontend/src/components/ExpandedCard.tsx, VideoItemWithHover.tsx, Top10Slider.tsx, hooks/useHoverExpand.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Screenshots: first card align=left, last card align=right, top10 hover centered."
  - task: "Homepage infinite scroll feed (admin sections + auto genre rows)"
    implemented: true
    working: true
    file: "frontend/src/pages/HomePage.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Rows grew 7 -> 27 while scrolling."
  - task: "New nav menu (Home, Serie TV, Film, Archivio, Premium, Richiedi un titolo) + ComingSoonPage placeholders + footer cleanup"
    implemented: true
    working: true
    file: "frontend/src/components/layouts/MainHeader.tsx, pages/ComingSoonPage.tsx, routes/index.tsx, layouts/Footer.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Screenshot verified /premium placeholder and logo -> /browse."

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 2
  run_ui: true

test_plan:
  current_focus:
    - "Uniform hover ExpandedCard (cards + Top 10) with edge-aware alignment (left/center/right)"
    - "Homepage infinite scroll feed (admin sections + auto genre rows)"
    - "New nav menu + ComingSoonPage placeholders + footer cleanup"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      comment: "Iteration 2: full UI restyle. Do not attempt to verify actual YouTube playback in headless Chrome (blocked by YouTube)."

# Iteration 3 (player bug fix)
frontend:
  - task: "WatchPage: stable iframe src (resume resolved once before mount), no reload after ~10s, progress from PLAYER_EVENT timeupdate, back button goes past iframe history entries"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/WatchPage.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Root cause: vixsrc iframe src recomputed on every render with initialProgress ref (startAt) -> src changed after async progress fetch/saves -> iframe reload + history pollution. Fixed. Self-check: src identical after 26s, history.length stable, back-button -> /browse."
backend:
  - task: "watch-progress min threshold lowered to 10s"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "POST /api/auth/watch-progress accepts progress >= 10"

# Iteration 4 (catalog filter, SC trailer scraper, hover grow animation, Top10 sizing, avatars, menu)
backend:
  - task: "vixsrc catalog filter: refresh_vixsrc_catalog + filter_available on all list endpoints (except upcoming), POST /api/public/availability, GET /api/public/availability/{type}/{id}"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Catalog from https://vixsrc.to/api/list/{movie,tv}/?lang=it cached in Mongo vixsrc_catalog (13.5k movies, 4.8k tv). fetch_tmdb_pages fetches 2-3 pages so rows stay full."
  - task: "GET /api/public/trailer/{type}/{id} (StreamingCommunity scraper when sc_base_url set, TMDB fallback) + admin settings GET/PUT /api/admin/settings, POST /api/admin/settings/refresh-catalog"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "SC domain empty by default -> source tmdb."
frontend:
  - task: "Hover grow-in-place animation (data-state open/closed), Top10 poster height = card height with SVG rank numbers, row titles aligned to cards (.row-title 46px), availability filter on search/detail similar/genre grid, avatar images + menu Account/La mia lista, admin Settings page"
    implemented: true
    working: "NA"
    file: "frontend/src/hooks/useHoverExpand.tsx, components/Top10Slider.tsx, hooks/useAvailability.ts, components/layouts/MainHeader.tsx, pages/AccountPage.tsx, admin/pages/SettingsPage.tsx, config/avatars.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Screenshots verified layout; needs functional test."
